const reportsStorageKey = "clean-hamilton-county-submitted-reports";
const reportDeletesKey = "clean-hamilton-county-submitted-report-deletes";
const impactsStorageKey = "clean-hamilton-county-volunteer-impact";
const impactDeletesKey = "clean-hamilton-county-volunteer-impact-deletes";
const supabaseSettings = window.CLEAN_HAMILTON_COUNTY_SUPABASE || {};
const cloudReports = supabaseSettings.url && supabaseSettings.anonKey && window.supabase
  ? window.supabase.createClient(supabaseSettings.url, supabaseSettings.anonKey)
  : null;
let reports = [];
let selectedPoint = null;
let selectedMarker = null;
let map;
let hotspotMarkersLayer;
let hotspotCirclesLayer;
let impacts = [];
let impactCloudAvailable = false;
let impactSyncMessage = "";
let impactSetupRequired = false;
let reportRevision = 0;
let impactRevision = 0;

function normalizeCoords(coords) {
  let point;
  if (Array.isArray(coords) && coords.length === 2) point = [Number(coords[0]), Number(coords[1])];
  else if (coords && typeof coords === "object" && coords.lat != null && coords.lng != null) point = [Number(coords.lat), Number(coords.lng)];
  else return null;
  return Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 90 && Math.abs(point[1]) <= 180 ? point : null;
}
function nextEntryId(entries) {
  return entries.reduce((nextId, entry) => {
    const existingId = Number(entry.id);
    return Number.isSafeInteger(existingId) ? Math.max(nextId, existingId + 1) : nextId;
  }, Date.now());
}
function normalizeReport(report) {
  return {
    ...report,
    status: report.status || "Needs attention",
    statusClass: report.statusClass || report.status_class || "open",
    image: report.image || "https://images.unsplash.com/photo-1501854140801-50d01698950b?auto=format&fit=crop&w=600&q=85",
    pickedUp: report.pickedUp === true || report.picked_up === true,
    pickedUpAt: report.pickedUpAt || report.picked_up_at || "",
    coords: normalizeCoords(report.coords),
  };
}
function fromCloudReport(report) {
  return normalizeReport({ ...report, statusClass: report.status_class, pickedUp: report.picked_up, pickedUpAt: report.picked_up_at });
}
function toCloudReport(report) {
  return { id: report.id, type: report.type, title: report.title, location: report.location, status: report.status,
    status_class: report.statusClass, coords: report.coords, amount: report.amount, severity: report.severity,
    notes: report.notes, date: report.date || null, risk: report.risk === true, image: report.image,
    picked_up: report.pickedUp === true, picked_up_at: report.pickedUpAt || null };
}
function readLocalReports() {
  try {
    const saved = JSON.parse(localStorage.getItem(reportsStorageKey) || "[]");
    return Array.isArray(saved) ? saved.filter((report) => report && report.id && report.type && report.location).map(normalizeReport) : [];
  } catch (error) { console.error("Unable to load saved reports.", error); return []; }
}
async function loadReports() {
  const localReports = readLocalReports();
  if (cloudReports) {
    try {
      let deletedIds = new Set(readReportDeletes());
      const deletedResults = await Promise.all([...deletedIds].map(async (id) => {
        try {
          const result = await cloudReports.from("reports").delete().eq("id", id);
          if (result.error) { console.error("Unable to sync a locally deleted report.", result.error); return null; }
          return id;
        } catch (error) { console.error("Unable to sync a locally deleted report.", error); return null; }
      }));
      const syncedDeletes = new Set(deletedResults.filter(Boolean));
      if (syncedDeletes.size) {
        deletedIds = new Set([...deletedIds].filter((id) => !syncedDeletes.has(id)));
        try { localStorage.setItem(reportDeletesKey, JSON.stringify([...deletedIds])); }
        catch (error) { console.error("Unable to clear synced report deletions.", error); }
      }
      const { data, error } = await cloudReports.from("reports").select("*").order("created_at", { ascending: false });
      if (!error) {
        const mergedReports = new Map((data || []).map((report) => {
          const normalized = fromCloudReport(report);
          return [String(normalized.id), normalized];
        }).filter(([id]) => !deletedIds.has(id)));
        const pendingReports = localReports.filter((report) => !deletedIds.has(String(report.id)));
        pendingReports.forEach((report) => mergedReports.set(String(report.id), report));
        const syncResults = await Promise.all(pendingReports.map(async (report) => {
            try {
              const result = await cloudReports.from("reports").upsert(toCloudReport(report));
              if (result.error) { console.error("Unable to sync a locally saved report.", result.error); return { id: String(report.id), synced: false }; }
              return { id: String(report.id), synced: true };
            } catch (syncError) { console.error("Unable to sync a locally saved report.", syncError); return { id: String(report.id), synced: false }; }
          }));
        const syncedIds = new Set(syncResults.filter((result) => result.synced).map((result) => result.id));
        if (syncedIds.size || deletedIds.size) {
          try {
            const currentLocalReports = readLocalReports();
            localStorage.setItem(reportsStorageKey, JSON.stringify(currentLocalReports.filter((report) => !syncedIds.has(String(report.id)) && !deletedIds.has(String(report.id)))));
          } catch (storageError) { console.error("Unable to clear synced local reports.", storageError); }
        }
        return [...mergedReports.values()];
      }
      console.error("Unable to load shared Hamilton County reports.", error);
    } catch (error) { console.error("Unable to reach shared Hamilton County reports.", error); }
    showToast("Shared reports could not be loaded. Showing this device's saved reports.");
  }
  const deletedIds = new Set(readReportDeletes());
  return localReports.filter((report) => !deletedIds.has(String(report.id)));
}
async function saveReport(report) {
  let savedLocally = false;
  try {
    const saved = JSON.parse(localStorage.getItem(reportsStorageKey) || "[]");
    const localReports = Array.isArray(saved) ? saved.filter((entry) => String(entry?.id) !== String(report.id)) : [];
    localReports.unshift(report);
    localStorage.setItem(reportsStorageKey, JSON.stringify(localReports));
    savedLocally = true;
  } catch (error) { console.error("Unable to save report in this browser.", error); }
  if (cloudReports) {
    try {
      const { error } = await cloudReports.from("reports").upsert(toCloudReport(report));
      if (!error) {
        try {
          const saved = JSON.parse(localStorage.getItem(reportsStorageKey) || "[]");
          if (Array.isArray(saved)) localStorage.setItem(reportsStorageKey, JSON.stringify(saved.filter((entry) => String(entry?.id) !== String(report.id))));
          localStorage.setItem(reportDeletesKey, JSON.stringify(readReportDeletes().filter((id) => id !== String(report.id))));
        } catch (storageError) { console.error("Unable to clear synced local report.", storageError); }
        return true;
      }
      console.error("Unable to save shared report.", error);
    } catch (error) { console.error("Unable to reach shared report storage.", error); }
    if (savedLocally) {
      showToast("Report saved on this device. Shared storage is temporarily unavailable.");
      return true;
    }
    showToast("The report could not be saved. Check your connection and try again.");
    return false;
  }
  if (savedLocally) return true;
  showToast("This report could not be saved in this browser.");
  return false;
}
function readReportDeletes() {
  try {
    const saved = JSON.parse(localStorage.getItem(reportDeletesKey) || "[]");
    return Array.isArray(saved) ? saved.map(String) : [];
  } catch (error) { console.error("Unable to load deleted report markers.", error); return []; }
}
async function deleteReport(id) {
  let deletedRemotely = false;
  if (cloudReports) {
    try {
      const { error } = await cloudReports.from("reports").delete().eq("id", id);
      if (error) console.error("Unable to delete shared report.", error);
      else deletedRemotely = true;
    } catch (error) { console.error("Unable to reach shared report storage.", error); }
  }
  try {
    const saved = JSON.parse(localStorage.getItem(reportsStorageKey) || "[]");
    if (!Array.isArray(saved)) throw new Error("Saved reports are not a valid list.");
    const deletedIds = new Set(readReportDeletes());
    if (cloudReports && !deletedRemotely) deletedIds.add(String(id));
    else deletedIds.delete(String(id));
    localStorage.setItem(reportDeletesKey, JSON.stringify([...deletedIds]));
    localStorage.setItem(reportsStorageKey, JSON.stringify(saved.filter((report) => String(report?.id) !== String(id))));
    return true;
  } catch (error) {
    console.error("Unable to persist deleted report.", error);
    return deletedRemotely;
  }
}
function normalizeImpact(entry) {
  return { ...entry, id: Number(entry.id), bags: Number(entry.bags) || 0, volunteers: Number(entry.volunteers) || 0, hours: Number(entry.hours) || 0, notes: entry.notes || "" };
}
function readLocalImpacts() {
  try {
    const saved = JSON.parse(localStorage.getItem(impactsStorageKey) || "[]");
    return Array.isArray(saved) ? saved.filter((entry) => entry && entry.id && entry.location).map(normalizeImpact) : [];
  } catch (error) { console.error("Unable to load volunteer impacts from this browser.", error); return []; }
}
function writeLocalImpacts(entries) {
  try {
    localStorage.setItem(impactsStorageKey, JSON.stringify(entries));
    return true;
  } catch (error) { console.error("Unable to save volunteer impacts in this browser.", error); return false; }
}
function readLocalImpactDeletes() {
  try {
    const saved = JSON.parse(localStorage.getItem(impactDeletesKey) || "[]");
    return Array.isArray(saved) ? saved.map(String) : [];
  } catch (error) { console.error("Unable to load deleted volunteer impact markers.", error); return []; }
}
async function loadImpacts() {
  const localEntries = readLocalImpacts();
  let deletedIds = new Set(readLocalImpactDeletes());
  let remoteEntries = null;
  if (cloudReports) {
    try {
      const deletedResults = await Promise.all([...deletedIds].map(async (id) => {
        try {
          const result = await cloudReports.from("impact_entries").delete().eq("id", id);
          if (result.error) { console.error("Unable to sync a locally deleted impact entry.", result.error); return null; }
          return id;
        } catch (error) { console.error("Unable to sync a locally deleted impact entry.", error); return null; }
      }));
      const syncedDeletes = new Set(deletedResults.filter(Boolean));
      if (syncedDeletes.size) {
        deletedIds = new Set([...deletedIds].filter((id) => !syncedDeletes.has(id)));
        try { localStorage.setItem(impactDeletesKey, JSON.stringify([...deletedIds])); }
        catch (error) { console.error("Unable to clear synced impact deletions.", error); }
      }
      const { data, error } = await cloudReports.from("impact_entries").select("*").order("cleanup_date", { ascending: false });
      if (!error) {
        remoteEntries = (data || []).map(normalizeImpact);
        impactCloudAvailable = true;
        impactSetupRequired = false;
        impactSyncMessage = "Shared impact storage is connected. Entries sync across devices.";
      } else {
        impactCloudAvailable = false;
        impactSetupRequired = error.code === "PGRST205" || error.code === "42P01";
        impactSyncMessage = impactSetupRequired
          ? "Supabase is online, but impact_entries has not been created. In Supabase Dashboard → SQL Editor, run the included setup SQL, then reload this site. Saved entries on this device will sync."
          : error.code === "42501"
            ? "Supabase rejected access to volunteer entries. Check the table's row-level security policies in the database setup SQL."
            : "Shared impact data could not be loaded. Entries are saved on this device until Supabase is configured.";
        console.error("Unable to load shared volunteer impacts.", error);
      }
    } catch (error) {
      impactCloudAvailable = false;
      impactSetupRequired = false;
      impactSyncMessage = "Supabase could not be reached. Entries are saved on this device until the connection is restored.";
      console.error("Unable to reach shared volunteer impacts.", error);
    }
  }
  if (remoteEntries === null) {
    if (cloudReports) showToast(impactSyncMessage);
    return localEntries.filter((entry) => !deletedIds.has(String(entry.id)));
  }
  const mergedEntries = new Map(remoteEntries.filter((entry) => !deletedIds.has(String(entry.id))).map((entry) => [String(entry.id), entry]));
  const pendingEntries = localEntries.filter((entry) => !deletedIds.has(String(entry.id)));
  pendingEntries.forEach((entry) => mergedEntries.set(String(entry.id), entry));
  const syncResults = await Promise.all(pendingEntries.map(async (entry) => {
    try {
      const { error } = await cloudReports.from("impact_entries").upsert(entry);
      if (error) { console.error("Unable to sync a locally saved impact entry.", error); return { id: String(entry.id), synced: false }; }
      return { id: String(entry.id), synced: true };
    } catch (error) { console.error("Unable to sync a locally saved impact entry.", error); return { id: String(entry.id), synced: false }; }
  }));
  const syncedIds = new Set(syncResults.filter((result) => result.synced).map((result) => result.id));
  if (syncedIds.size) writeLocalImpacts(readLocalImpacts().filter((entry) => !syncedIds.has(String(entry.id))));
  if (syncResults.some((result) => !result.synced)) {
    impactSyncMessage = "Some entries are still saved on this device and will retry syncing when Supabase is available.";
  }
  return [...mergedEntries.values()].sort((left, right) => String(right.cleanup_date).localeCompare(String(left.cleanup_date)));
}
async function saveImpact(entry) {
  const pendingEntries = readLocalImpacts().filter((saved) => String(saved.id) !== String(entry.id));
  pendingEntries.unshift(entry);
  const savedLocally = writeLocalImpacts(pendingEntries);
  if (cloudReports) {
    try {
      const { error } = await cloudReports.from("impact_entries").upsert(entry);
      if (!error) {
        impactCloudAvailable = true;
        impactSetupRequired = false;
        impactSyncMessage = "Shared impact storage is connected. Entries sync across devices.";
        writeLocalImpacts(readLocalImpacts().filter((saved) => String(saved.id) !== String(entry.id)));
        localStorage.setItem(impactDeletesKey, JSON.stringify(readLocalImpactDeletes().filter((id) => id !== String(entry.id))));
        return "shared";
      }
      impactCloudAvailable = false;
      impactSetupRequired = error.code === "PGRST205" || error.code === "42P01";
      impactSyncMessage = impactSetupRequired
        ? "Supabase is online, but impact_entries has not been created. This entry is saved on this device and will sync after you run the included setup SQL in Supabase Dashboard → SQL Editor."
        : error.code === "42501"
          ? "Supabase rejected this entry. Check the table permissions in the database setup SQL."
          : "Could not share this entry. It is saved on this device and will retry later.";
      console.error("Unable to save shared volunteer impact.", error);
    } catch (error) {
      impactCloudAvailable = false;
      impactSetupRequired = false;
      impactSyncMessage = "Supabase could not be reached. This entry is saved on this device and will retry later.";
      console.error("Unable to reach shared volunteer impacts.", error);
    }
    return savedLocally ? "local" : false;
  }
  return savedLocally ? "local" : false;
}
async function deleteImpact(id) {
  if (cloudReports) {
    try {
      const { error } = await cloudReports.from("impact_entries").delete().eq("id", id);
      if (error) {
        console.error("Unable to delete shared volunteer impact.", error);
        localStorage.setItem(impactDeletesKey, JSON.stringify([...new Set([...readLocalImpactDeletes(), String(id)])]));
        writeLocalImpacts(readLocalImpacts().filter((entry) => String(entry.id) !== String(id)));
        return "local";
      }
      writeLocalImpacts(readLocalImpacts().filter((entry) => String(entry.id) !== String(id)));
      localStorage.setItem(impactDeletesKey, JSON.stringify(readLocalImpactDeletes().filter((deletedId) => deletedId !== String(id))));
      return "shared";
    } catch (error) {
      console.error("Unable to reach shared volunteer impacts.", error);
      localStorage.setItem(impactDeletesKey, JSON.stringify([...new Set([...readLocalImpactDeletes(), String(id)])]));
      writeLocalImpacts(readLocalImpacts().filter((entry) => String(entry.id) !== String(id)));
      return "local";
    }
  }
  writeLocalImpacts(readLocalImpacts().filter((entry) => String(entry.id) !== String(id)));
  return "local";
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}
function renderMap() {
  if (!map || !window.L) return;
  hotspotMarkersLayer.clearLayers();
  hotspotCirclesLayer.clearLayers();
  const reportHotspots = reports.filter((report) => report.coords).map((report) => ({
    name: report.title,
    type: report.type,
    coords: report.coords,
    amount: report.amount,
    severity: report.severity && report.severity.toLowerCase().startsWith("high") ? "high" : report.severity && report.severity.toLowerCase().startsWith("medium") ? "medium" : "low",
    description: report.location,
    notes: report.notes,
    date: report.date,
    risk: report.risk,
    pickedUp: report.pickedUp,
    radius: report.severity && report.severity.toLowerCase().startsWith("high") ? 280
      : report.severity && report.severity.toLowerCase().startsWith("medium") ? 200 : 120,
    reportId: report.id
  }));
  reportHotspots.forEach((hotspot) => {
    const severityColor = hotspot.severity === "high" ? "#f44336" : hotspot.severity === "medium" ? "#ff9800" : "#4caf50";
    const color = hotspot.pickedUp ? "#64748b" : severityColor;
    const marker = L.marker(hotspot.coords).addTo(hotspotMarkersLayer);
    const action = hotspot.reportId ? `<div class="hotspot-popup-actions"><button type="button" data-hotspot-pickup="${escapeHtml(hotspot.reportId)}">${hotspot.pickedUp ? "Restore report" : "Mark picked up"}</button><button type="button" class="hotspot-delete-button" data-hotspot-delete="${escapeHtml(hotspot.reportId)}">Delete report</button></div>` : "";
    const details = [
      hotspot.type ? `<br>${escapeHtml(hotspot.type)} · ${escapeHtml(hotspot.amount || "Amount not specified")}` : "",
      hotspot.date ? `<br>Observed ${escapeHtml(formatReportDate(hotspot.date))}` : "",
      hotspot.risk ? "<br><strong>Safety or environmental risk reported</strong>" : "",
      hotspot.notes ? `<br><small>${escapeHtml(hotspot.notes)}</small>` : ""
    ].join("");
    marker.bindPopup(`<strong>${escapeHtml(hotspot.name)}</strong><br>${hotspot.pickedUp ? "Picked up · hotspot retained" : `${escapeHtml(hotspot.severity)} severity`}${details}<br><small>${escapeHtml(hotspot.description)}</small>${action}`, { className: "hotspot-popup" });
    marker.on("popupopen", (event) => {
      const popup = event.popup.getElement();
      const pickupButton = popup?.querySelector("[data-hotspot-pickup]");
      pickupButton?.addEventListener("click", (clickEvent) => {
        clickEvent.preventDefault();
        const report = reports.find((entry) => String(entry.id) === String(hotspot.reportId));
        if (report) setPickedUp(report.id, !report.pickedUp);
      });
      const deleteButton = popup?.querySelector("[data-hotspot-delete]");
      deleteButton?.addEventListener("click", (clickEvent) => {
        clickEvent.preventDefault();
        removeReport(hotspot.reportId);
      });
    });
    const circle = L.circle(hotspot.coords, {
      color,
      fillColor: color,
      fillOpacity: hotspot.pickedUp ? .12 : .25,
      dashArray: hotspot.pickedUp ? "5 6" : null,
      radius: hotspot.radius
    }).addTo(hotspotCirclesLayer);
    circle.bindPopup(`<strong>${escapeHtml(hotspot.name)}</strong><br>${hotspot.pickedUp ? "Picked up · hotspot retained for monitoring" : `${escapeHtml(hotspot.severity)} severity`}<br>${escapeHtml(hotspot.description)}`);
  });
}
function initMap() {
  if (!window.L || !document.querySelector("#map")) return;
  map = L.map("map", { center: [40.0462, -86.1277], zoom: 13, minZoom: 9, maxZoom: 20, zoomControl: true, scrollWheelZoom: true });
  const lightLayer = L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
    maxZoom: 20,
    attribution: "&copy; OpenStreetMap contributors, OSM-FR"
  }).addTo(map);
  hotspotMarkersLayer = L.layerGroup().addTo(map);
  hotspotCirclesLayer = L.layerGroup().addTo(map);
  map.on("click", (event) => selectPoint(event.latlng.lat, event.latlng.lng));
  const legend = L.control({ position: "bottomright" });
  legend.onAdd = () => {
    const div = L.DomUtil.create("div", "map-legend");
    div.innerHTML = "<h4>Reported issue severity</h4><div class=\"legend-item\"><span class=\"legend-color legend-high\"></span>High</div><div class=\"legend-item\"><span class=\"legend-color legend-medium\"></span>Medium</div><div class=\"legend-item\"><span class=\"legend-color legend-low\"></span>Low</div><div class=\"legend-item\"><span class=\"legend-color legend-picked-up\"></span>Picked up · retained</div>";
    return div;
  };
  legend.addTo(map);
  L.control.layers({ "Light Basemap": lightLayer }, { "Hotspot Markers": hotspotMarkersLayer, "Hotspot Circles": hotspotCirclesLayer }, { collapsed: false }).addTo(map);
  renderMap();
}
function selectPoint(latitude, longitude) {
  selectedPoint = [Number(latitude), Number(longitude)];
  if (selectedMarker) selectedMarker.setLatLng(selectedPoint);
  else selectedMarker = L.marker(selectedPoint, { title: "Selected report location" }).addTo(map);
  selectedMarker.bindPopup("Selected report location").openPopup();
  const locationInput = document.querySelector("#location-input");
  if (!locationInput.value.trim() || locationInput.value.startsWith("Pinned location (")) {
    locationInput.value = `Pinned location (${selectedPoint[0].toFixed(5)}, ${selectedPoint[1].toFixed(5)})`;
  }
  document.querySelector("#selected-location").hidden = false;
  document.querySelector("#selected-location").textContent = `Exact report location selected: ${selectedPoint[0].toFixed(5)}, ${selectedPoint[1].toFixed(5)}. Submit the report to add its severity circle.`;
  showToast("Exact map location selected for your report.");
}
function requestCurrentLocation(button) {
  if (!navigator.geolocation) return showToast("Location services are not available in this browser.");
  button.disabled = true; showToast("Requesting your location…");
  navigator.geolocation.getCurrentPosition((position) => {
    selectPoint(position.coords.latitude, position.coords.longitude);
    button.disabled = false;
  }, () => { showToast("Location access was unavailable. Click the map or try again."); button.disabled = false; },
  { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
}
async function setPickedUp(id, pickedUp) {
  const report = reports.find((entry) => String(entry.id) === String(id));
  if (!report) return;
  const previousState = { pickedUp: report.pickedUp, pickedUpAt: report.pickedUpAt, status: report.status, statusClass: report.statusClass };
  report.pickedUp = pickedUp; report.pickedUpAt = pickedUp ? new Date().toISOString() : "";
  report.status = pickedUp ? "Picked up" : "Needs attention"; report.statusClass = pickedUp ? "resolved" : "open";
  reportRevision += 1;
  if (await saveReport(report)) {
    renderReportList(); renderPickupHistory(); renderMap();
    showToast(pickedUp ? "Marked picked up; history retained." : "Report returned to active reports.");
  } else {
    Object.assign(report, previousState);
    reportRevision += 1;
    renderReportList(); renderPickupHistory(); renderMap();
  }
}
async function removeReport(id) {
  const report = reports.find((entry) => String(entry.id) === String(id));
  if (!report || !window.confirm("Permanently delete this report and its hotspot from the map? This cannot be undone.")) return;
  if (!await deleteReport(id)) {
    showToast("This report could not be deleted. Please try again.");
    return;
  }
  reports = reports.filter((entry) => String(entry.id) !== String(id));
  reportRevision += 1;
  if (!cloudReports) {
    try { localStorage.setItem(reportsStorageKey, JSON.stringify(reports)); }
    catch (error) { console.error("Unable to persist deleted report locally.", error); }
  }
  renderReportList();
  renderPickupHistory();
  renderMap();
  showToast("Report and hotspot deleted.");
}
function renderReportList(filter = "all") {
  const list = document.querySelector("#report-list"); if (!list) return;
  const activeCount = reports.filter((report) => !report.pickedUp).length;
  const nearbyHeading = document.querySelector(".nearby-header h3");
  const nearbyMessage = document.querySelector(".nearby-panel .waiting-copy");
  if (nearbyHeading) nearbyHeading.textContent = activeCount ? `${activeCount} active report${activeCount === 1 ? "" : "s"}` : "No reports yet";
  if (nearbyMessage) nearbyMessage.textContent = activeCount
    ? "Open the submitted reports list to review locations, details, and cleanup status."
    : "No community reports have been submitted yet. When neighbors add reports, their locations will appear on the map.";
  const visible = reports.filter((r) => !r.pickedUp && (filter === "all" || r.type === filter)).slice(0, 8);
  list.innerHTML = visible.map((r) => `<div class="report-item" data-report-id="${escapeHtml(r.id)}">
    <div class="report-thumb" style="background-image:url('${escapeHtml(r.image)}')"></div><div class="report-info">
    <div class="report-title">${escapeHtml(r.title)}</div><div class="report-meta">${escapeHtml(r.location)}</div>
    <span class="report-status status-${escapeHtml(r.statusClass)}">${escapeHtml(r.status)}</span></div>
    <button class="pickup-check" type="button" data-pickup-id="${escapeHtml(r.id)}">Mark picked up</button></div>`).join("");
  const empty = document.querySelector("#empty-reports"); if (empty) empty.hidden = visible.length > 0;
  list.querySelectorAll("[data-pickup-id]").forEach((button) => button.addEventListener("click", (event) => { event.stopPropagation(); setPickedUp(button.dataset.pickupId, true); }));
}
function formatReportDate(value) { if (!value) return "Date not provided"; const date = new Date(`${value}T00:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(); }
function renderPickupHistory() {
  const list = document.querySelector("#pickup-history-list"), empty = document.querySelector("#pickup-history-empty"); if (!list || !empty) return;
  const completed = reports.filter((r) => r.pickedUp);
  list.innerHTML = completed.map((r) => `<article class="pickup-history-item"><div><strong>${escapeHtml(r.title)}</strong><p><span class="history-meta">Location:</span> ${escapeHtml(r.location)}<br><span class="history-meta">Original report:</span> ${formatReportDate(r.date)} · <span class="history-meta">Picked up:</span> ${r.pickedUpAt ? new Date(r.pickedUpAt).toLocaleDateString() : "Date not recorded"}<br><span class="history-meta">Category:</span> ${escapeHtml(r.type)} · <span class="history-meta">Notes:</span> ${escapeHtml(r.notes || "None")}</p></div><div class="pickup-history-actions"><button type="button" class="restore-history-button" data-restore-history="${escapeHtml(r.id)}">Restore report</button><button type="button" class="delete-history-button" data-delete-history="${escapeHtml(r.id)}">Permanently delete</button></div></article>`).join("");
  empty.hidden = completed.length > 0;
  list.querySelectorAll("[data-restore-history]").forEach((button) => button.addEventListener("click", () => setPickedUp(button.dataset.restoreHistory, false)));
  list.querySelectorAll("[data-delete-history]").forEach((button) => button.addEventListener("click", async () => {
    await removeReport(button.dataset.deleteHistory);
  }));
}
function todayDateInputValue() {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${today.getFullYear()}-${month}-${day}`;
}
function resetReportForm() {
  const form = document.querySelector("#report-form");
  if (!form) return;
  form.reset();
  form.hidden = false;
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = false;
  submitButton.removeAttribute("aria-busy");
  document.querySelector("#success-message").hidden = true;
  document.querySelector("#selected-location").hidden = true;
  document.querySelector("#photo-help").textContent = "Optional · image up to 10 MB, optimized automatically";
  form.elements.date.value = todayDateInputValue();
  if (selectedMarker && map) map.removeLayer(selectedMarker);
  selectedMarker = null;
  selectedPoint = null;
}
function renderImpacts() {
  const list = document.querySelector("#impact-list"), empty = document.querySelector("#impact-empty"), totals = document.querySelector("#impact-totals");
  if (!list || !empty || !totals) return;
  const saveStatus = document.querySelector("#impact-save-status");
  if (saveStatus) saveStatus.textContent = impactSyncMessage || (impactCloudAvailable
    ? "Shared impact storage is connected. Entries sync across devices."
    : "Entries save on this device. Cross-device syncing needs Supabase reachable and the impact_entries table created from the latest supabase-setup.sql.");
  const setupLink = document.querySelector("#impact-setup-link");
  if (setupLink) setupLink.hidden = !impactSetupRequired;
  const totalBags = impacts.reduce((sum, entry) => sum + entry.bags, 0);
  const totalHours = impacts.reduce((sum, entry) => sum + entry.hours, 0);
  const totalVolunteers = impacts.reduce((sum, entry) => sum + entry.volunteers, 0);
  totals.innerHTML = `<div><strong>${totalBags}</strong><span>Bags picked up</span></div><div><strong>${totalHours}</strong><span>Volunteer hours</span></div><div><strong>${totalVolunteers}</strong><span>Volunteer contributions</span></div>`;
  list.innerHTML = impacts.map((entry) => `<article class="impact-entry"><div><strong>${escapeHtml(entry.location)} <span class="history-meta">${formatReportDate(entry.cleanup_date)}</span></strong><p>${entry.bags} bags · ${entry.volunteers} volunteers · ${entry.hours} hours${entry.notes ? ` · ${escapeHtml(entry.notes)}` : ""}</p></div><div class="impact-entry-actions"><button type="button" data-edit-impact="${escapeHtml(entry.id)}">Edit</button><button type="button" data-delete-impact="${escapeHtml(entry.id)}">Delete</button></div></article>`).join("");
  empty.hidden = impacts.length > 0;
  list.querySelectorAll("[data-edit-impact]").forEach((button) => button.addEventListener("click", () => {
    const entry = impacts.find((item) => String(item.id) === button.dataset.editImpact), form = document.querySelector("#impact-form");
    if (!entry || !form) return;
    Object.entries(entry).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value; });
    form.elements.id.value = entry.id;
    document.querySelector("#impact-submit-label").textContent = "Save changes";
    document.querySelector("#impact-cancel").hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }));
  list.querySelectorAll("[data-delete-impact]").forEach((button) => button.addEventListener("click", async () => {
    if (!window.confirm("Delete this volunteer impact entry?")) return;
    const deletion = await deleteImpact(button.dataset.deleteImpact);
    if (deletion) {
      impacts = impacts.filter((entry) => String(entry.id) !== button.dataset.deleteImpact);
      impactRevision += 1;
      renderImpacts();
      showToast(deletion === "shared" ? "Impact entry deleted for everyone." : "Impact entry deleted on this device only.");
    }
  }));
}
function resetImpactForm() {
  const form = document.querySelector("#impact-form");
  if (!form) return;
  form.reset(); form.elements.id.value = "";
  form.elements.cleanup_date.value = todayDateInputValue();
  document.querySelector("#impact-submit-label").textContent = "Add impact";
  document.querySelector("#impact-cancel").hidden = true;
}
function showToast(message) { const toast = document.querySelector("#toast"); if (!toast) return; toast.textContent = message; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 3500); }
async function prepareReportPhoto(file) {
  if (!file) return "https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=600&q=85";
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Choose an image smaller than 10 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } finally { bitmap.close(); }
}
async function refreshSharedReports() {
  const version = reportRevision;
  const loaded = await loadReports();
  if (reportRevision === version) reports = loaded;
  else {
    const deletedIds = new Set(readReportDeletes());
    const merged = new Map(loaded.filter((report) => !deletedIds.has(String(report.id))).map((report) => [String(report.id), report]));
    reports.filter((report) => !deletedIds.has(String(report.id))).forEach((report) => merged.set(String(report.id), report));
    reports = [...merged.values()];
  }
  renderReportList(); renderPickupHistory(); renderMap();
}
async function refreshSharedImpacts() {
  const version = impactRevision;
  const loaded = await loadImpacts();
  if (impactRevision === version) impacts = loaded;
  else {
    const deletedIds = new Set(readLocalImpactDeletes());
    const merged = new Map(loaded.filter((entry) => !deletedIds.has(String(entry.id))).map((entry) => [String(entry.id), entry]));
    impacts.filter((entry) => !deletedIds.has(String(entry.id))).forEach((entry) => merged.set(String(entry.id), entry));
    impacts = [...merged.values()];
  }
  renderImpacts();
}

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  reports = readLocalReports();
  renderReportList();
  renderPickupHistory();
  renderMap();
  refreshSharedReports();
  impacts = readLocalImpacts();
  renderImpacts();
  refreshSharedImpacts();
  document.querySelector("#use-location")?.addEventListener("click", (event) => requestCurrentLocation(event.currentTarget));
  document.querySelector("#map-use-location")?.addEventListener("click", (event) => requestCurrentLocation(event.currentTarget));
  document.querySelectorAll(".filter-chip").forEach((chip) => chip.addEventListener("click", () => { document.querySelectorAll(".filter-chip").forEach((b) => b.classList.remove("active")); chip.classList.add("active"); renderReportList(chip.dataset.filter); }));
  document.querySelectorAll("[data-scroll-to]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.scrollTo)?.scrollIntoView({ behavior: "smooth" })));
  const toggle = document.querySelector("#toggle-submitted-reports"), content = document.querySelector("#submitted-reports-content");
  toggle?.addEventListener("click", () => { const expanded = toggle.getAttribute("aria-expanded") === "true"; toggle.setAttribute("aria-expanded", String(!expanded)); content.hidden = expanded; toggle.lastElementChild.textContent = expanded ? "＋" : "−"; });
  document.querySelector("#report-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const reportForm = event.currentTarget;
    const form = new FormData(reportForm);
    const typedLocation = String(form.get("location") || "").trim();
    if (!selectedPoint) {
      showToast("Select the exact spot on the map or use your location. A map pin is required to place the hotspot circle.");
      return;
    }
    if (!typedLocation) return showToast("Enter a place name for this report.");
    const submitButton = reportForm.querySelector('button[type="submit"]');
    if (submitButton.disabled) return;
    submitButton.disabled = true;
    submitButton.setAttribute("aria-busy", "true");
    let image;
    try { image = await prepareReportPhoto(document.querySelector("#photo-input")?.files?.[0]); }
    catch (error) {
      showToast(error.message || "The selected photo could not be prepared.");
      submitButton.disabled = false;
      submitButton.removeAttribute("aria-busy");
      return;
    }
    const type = form.get("type"); const report = normalizeReport({ id: nextEntryId(reports), type, title: `${type === "litter" ? "Litter" : type === "dumping" ? "Dumping" : "Environmental concern"} reported by a neighbor`, location: typedLocation || `Hamilton County map pin (${selectedPoint[0].toFixed(5)}, ${selectedPoint[1].toFixed(5)})`, status: "Needs attention", statusClass: "open", coords: selectedPoint, amount: form.get("amount"), severity: form.get("severity"), notes: form.get("notes"), date: form.get("date"), risk: form.get("risk") === "on", image });
    reports.unshift(report); reportRevision += 1; if (await saveReport(report)) {
      renderReportList(); renderPickupHistory(); renderMap();
      if (selectedMarker) map.removeLayer(selectedMarker);
      selectedMarker = null; selectedPoint = null;
      reportForm.hidden = true; document.querySelector("#success-message").hidden = false;
      showToast("Report and severity circle added to the Hamilton County community map.");
    } else {
      reports.shift();
      submitButton.disabled = false;
      submitButton.removeAttribute("aria-busy");
    }
  });
  document.querySelector("#another-report")?.addEventListener("click", resetReportForm);
  document.querySelector("#impact-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target), id = Number(form.get("id")) || nextEntryId(impacts);
    const entry = normalizeImpact({ id, cleanup_date: form.get("cleanup_date"), location: String(form.get("location") || "").trim(), bags: form.get("bags"), volunteers: form.get("volunteers"), hours: form.get("hours"), notes: String(form.get("notes") || "").trim() });
    if (!entry.location) return showToast("Add a cleanup location first.");
    const previous = impacts.findIndex((item) => item.id === id), old = previous >= 0 ? impacts[previous] : null;
    if (previous >= 0) impacts[previous] = entry; else impacts.unshift(entry);
    impactRevision += 1;
    const saved = await saveImpact(entry);
    if (saved) {
      renderImpacts(); resetImpactForm();
      showToast(saved === "shared"
        ? (old ? "Impact entry updated for everyone." : "Impact entry shared with everyone.")
        : (impactSyncMessage || "Saved on this device only. Check Supabase connectivity and database setup to enable sharing."));
    } else {
      if (previous >= 0) impacts[previous] = old; else impacts.shift();
      showToast("This impact entry could not be saved. Check browser storage settings.");
    }
  });
  document.querySelector("#impact-cancel")?.addEventListener("click", resetImpactForm);
  document.querySelector("#photo-input")?.addEventListener("change", (event) => {
    const file = event.currentTarget.files?.[0];
    const help = document.querySelector("#photo-help");
    if (help) help.textContent = file ? `${file.name} · optimized when submitted` : "Optional · image up to 10 MB, optimized automatically";
  });
  const date = document.querySelector('input[name="date"]'); if (date) date.value = todayDateInputValue();
  const cleanupDate = document.querySelector('input[name="cleanup_date"]'); if (cleanupDate) cleanupDate.value = todayDateInputValue();
  if (cloudReports) cloudReports.channel("hamilton-county-reports").on("postgres_changes", { event: "*", schema: "public", table: "reports" }, refreshSharedReports).subscribe();
  if (cloudReports) cloudReports.channel("hamilton-county-impacts").on("postgres_changes", { event: "*", schema: "public", table: "impact_entries" }, refreshSharedImpacts).subscribe();
});
