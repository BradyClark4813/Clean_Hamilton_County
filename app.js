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

function normalizeCoords(coords) {
  if (Array.isArray(coords) && coords.length === 2) return [Number(coords[0]), Number(coords[1])];
  if (coords && typeof coords === "object" && coords.lat != null && coords.lng != null) return [Number(coords.lat), Number(coords.lng)];
  return null;
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
      const { data, error } = await cloudReports.from("reports").select("*").order("created_at", { ascending: false });
      if (!error) {
        const deletedIds = new Set(readReportDeletes());
        const mergedReports = new Map((data || []).map((report) => {
          const normalized = fromCloudReport(report);
          return [String(normalized.id), normalized];
        }).filter(([id]) => !deletedIds.has(id)));
        localReports.forEach((report) => mergedReports.set(String(report.id), report));
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
  if (cloudReports) {
    try {
      const { error } = await cloudReports.from("reports").delete().eq("id", id);
      if (error) console.error("Unable to delete shared report.", error);
      else {
        try { localStorage.setItem(reportDeletesKey, JSON.stringify(readReportDeletes().filter((deletedId) => deletedId !== String(id)))); }
        catch (storageError) { console.error("Unable to update deleted report markers.", storageError); }
      }
    } catch (error) { console.error("Unable to reach shared report storage.", error); }
    try {
      const saved = JSON.parse(localStorage.getItem(reportsStorageKey) || "[]");
      if (Array.isArray(saved)) localStorage.setItem(reportsStorageKey, JSON.stringify(saved.filter((report) => String(report?.id) !== String(id))));
      localStorage.setItem(reportDeletesKey, JSON.stringify([...new Set([...readReportDeletes(), String(id)])]));
    } catch (error) { console.error("Unable to record local report deletion.", error); }
    return true;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(reportsStorageKey) || "[]");
    if (Array.isArray(saved)) localStorage.setItem(reportsStorageKey, JSON.stringify(saved.filter((report) => String(report?.id) !== String(id))));
  } catch (error) { console.error("Unable to update saved reports.", error); }
  return true;
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
  const deletedIds = new Set(readLocalImpactDeletes());
  let remoteEntries = null;
  if (cloudReports) {
    try {
      const { data, error } = await cloudReports.from("impact_entries").select("*").order("cleanup_date", { ascending: false });
      if (!error) { remoteEntries = (data || []).map(normalizeImpact); impactCloudAvailable = true; }
      else { impactCloudAvailable = false; console.error("Unable to load shared volunteer impacts.", error); }
    } catch (error) { impactCloudAvailable = false; console.error("Unable to reach shared volunteer impacts.", error); }
  }
  if (remoteEntries === null) {
    if (cloudReports) showToast("Shared impact data is unavailable. Showing entries saved on this device.");
    return localEntries;
  }
  const mergedEntries = new Map(remoteEntries.filter((entry) => !deletedIds.has(String(entry.id))).map((entry) => [String(entry.id), entry]));
  localEntries.forEach((entry) => mergedEntries.set(String(entry.id), entry));
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
        writeLocalImpacts(readLocalImpacts().filter((saved) => String(saved.id) !== String(entry.id)));
        localStorage.setItem(impactDeletesKey, JSON.stringify(readLocalImpactDeletes().filter((id) => id !== String(entry.id))));
        return "shared";
      }
      impactCloudAvailable = false;
      console.error("Unable to save shared volunteer impact.", error);
    } catch (error) { impactCloudAvailable = false; console.error("Unable to reach shared volunteer impacts.", error); }
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
  if (!map.hasLayer(hotspotMarkersLayer)) hotspotMarkersLayer.addTo(map);
  if (!map.hasLayer(hotspotCirclesLayer)) hotspotCirclesLayer.addTo(map);
  hotspotMarkersLayer.clearLayers();
  hotspotCirclesLayer.clearLayers();
  const reportHotspots = reports.filter((report) => report.coords).map((report) => ({
    name: report.title,
    coords: report.coords,
    severity: report.severity && report.severity.toLowerCase().startsWith("high") ? "high" : report.severity && report.severity.toLowerCase().startsWith("medium") ? "medium" : "low",
    description: report.location,
    radius: 150,
    reportId: report.id
  }));
  reportHotspots.forEach((hotspot) => {
    const color = hotspot.severity === "high" ? "#f44336" : hotspot.severity === "medium" ? "#ff9800" : "#4caf50";
    const marker = L.marker(hotspot.coords).addTo(hotspotMarkersLayer);
    const action = hotspot.reportId ? `<br><button type="button" data-hotspot-pickup="${hotspot.reportId}">${reports.find((report) => report.id === hotspot.reportId)?.pickedUp ? "Restore report" : "Mark picked up"}</button>` : "";
    marker.bindPopup(`<strong>${escapeHtml(hotspot.name)}</strong><br>${hotspot.severity} trash density<br><small>${escapeHtml(hotspot.description)}</small>${action}`, { className: "hotspot-popup" });
    const circle = L.circle(hotspot.coords, { color, fillColor: color, fillOpacity: .25, radius: hotspot.radius }).addTo(hotspotCirclesLayer);
    circle.bindPopup(`<strong>${escapeHtml(hotspot.name)}</strong><br>${escapeHtml(hotspot.description)}`);
  });
  document.querySelectorAll("[data-hotspot-pickup]").forEach((button) => button.addEventListener("click", () => {
    const report = reports.find((entry) => String(entry.id) === button.dataset.hotspotPickup);
    if (report) setPickedUp(report.id, !report.pickedUp);
  }));
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
  const legend = L.control({ position: "bottomright" });
  legend.onAdd = () => {
    const div = L.DomUtil.create("div", "map-legend");
    div.innerHTML = "<h4>Reported issue severity</h4><div class=\"legend-item\"><span class=\"legend-color legend-high\"></span>High</div><div class=\"legend-item\"><span class=\"legend-color legend-medium\"></span>Medium</div><div class=\"legend-item\"><span class=\"legend-color legend-low\"></span>Low</div>";
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
  document.querySelector("#location-input").value = `Pinned location (${selectedPoint[0].toFixed(5)}, ${selectedPoint[1].toFixed(5)})`;
  document.querySelector("#selected-location").hidden = false;
  showToast("Exact map location selected for your report.");
}
function requestCurrentLocation(button) {
  if (!navigator.geolocation) return showToast("Location services are not available in this browser.");
  button.disabled = true; showToast("Requesting your location…");
  navigator.geolocation.getCurrentPosition((position) => {
    selectPoint(position.coords.latitude, position.coords.longitude);
    button.disabled = false;
  }, () => { showToast("Location access was unavailable. Click the map or type a location."); button.disabled = false; },
  { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
}
async function setPickedUp(id, pickedUp) {
  const report = reports.find((entry) => String(entry.id) === String(id));
  if (!report) return;
  report.pickedUp = pickedUp; report.pickedUpAt = pickedUp ? new Date().toISOString() : "";
  report.status = pickedUp ? "Picked up" : "Needs attention"; report.statusClass = pickedUp ? "resolved" : "open";
  if (await saveReport(report)) { renderReportList(); renderPickupHistory(); renderMap(); showToast(pickedUp ? "Marked picked up; history retained." : "Report returned to active reports."); }
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
  list.innerHTML = visible.map((r) => `<div class="report-item" data-report-id="${r.id}">
    <div class="report-thumb" style="background-image:url('${escapeHtml(r.image)}')"></div><div class="report-info">
    <div class="report-title">${escapeHtml(r.title)}</div><div class="report-meta">${escapeHtml(r.location)}</div>
    <span class="report-status status-${escapeHtml(r.statusClass)}">${escapeHtml(r.status)}</span></div>
    <button class="pickup-check" type="button" data-pickup-id="${r.id}">Mark picked up</button></div>`).join("");
  const empty = document.querySelector("#empty-reports"); if (empty) empty.hidden = visible.length > 0;
  list.querySelectorAll("[data-pickup-id]").forEach((button) => button.addEventListener("click", (event) => { event.stopPropagation(); setPickedUp(button.dataset.pickupId, true); }));
}
function formatReportDate(value) { if (!value) return "Date not provided"; const date = new Date(`${value}T00:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(); }
function renderPickupHistory() {
  const list = document.querySelector("#pickup-history-list"), empty = document.querySelector("#pickup-history-empty"); if (!list || !empty) return;
  const completed = reports.filter((r) => r.pickedUp);
  list.innerHTML = completed.map((r) => `<article class="pickup-history-item"><div><strong>${escapeHtml(r.title)}</strong><p><span class="history-meta">Location:</span> ${escapeHtml(r.location)}<br><span class="history-meta">Original report:</span> ${formatReportDate(r.date)} · <span class="history-meta">Picked up:</span> ${r.pickedUpAt ? new Date(r.pickedUpAt).toLocaleDateString() : "Date not recorded"}<br><span class="history-meta">Category:</span> ${escapeHtml(r.type)} · <span class="history-meta">Notes:</span> ${escapeHtml(r.notes || "None")}</p></div><button type="button" class="delete-history-button" data-delete-history="${r.id}">Permanently delete</button></article>`).join("");
  empty.hidden = completed.length > 0;
  list.querySelectorAll("[data-delete-history]").forEach((button) => button.addEventListener("click", async () => {
    if (!window.confirm("Permanently delete this pickup history record?")) return;
    if (await deleteReport(button.dataset.deleteHistory)) { reports = reports.filter((r) => String(r.id) !== button.dataset.deleteHistory); if (!cloudReports) localStorage.setItem(reportsStorageKey, JSON.stringify(reports)); renderPickupHistory(); renderMap(); }
  }));
}
function renderImpacts() {
  const list = document.querySelector("#impact-list"), empty = document.querySelector("#impact-empty"), totals = document.querySelector("#impact-totals");
  if (!list || !empty || !totals) return;
  const saveStatus = document.querySelector("#impact-save-status");
  if (saveStatus) saveStatus.textContent = impactCloudAvailable
    ? "Shared impact storage is connected. Entries sync across devices."
    : "Entries save on this device. Cross-device syncing needs Supabase reachable and the impact_entries table created from the latest supabase-setup.sql.";
  const totalBags = impacts.reduce((sum, entry) => sum + entry.bags, 0);
  const totalHours = impacts.reduce((sum, entry) => sum + entry.hours, 0);
  const totalVolunteers = impacts.reduce((sum, entry) => sum + entry.volunteers, 0);
  totals.innerHTML = `<div><strong>${totalBags}</strong><span>Bags picked up</span></div><div><strong>${totalHours}</strong><span>Volunteer hours</span></div><div><strong>${totalVolunteers}</strong><span>Volunteer contributions</span></div>`;
  list.innerHTML = impacts.map((entry) => `<article class="impact-entry"><div><strong>${escapeHtml(entry.location)} <span class="history-meta">${formatReportDate(entry.cleanup_date)}</span></strong><p>${entry.bags} bags · ${entry.volunteers} volunteers · ${entry.hours} hours${entry.notes ? ` · ${escapeHtml(entry.notes)}` : ""}</p></div><div class="impact-entry-actions"><button type="button" data-edit-impact="${entry.id}">Edit</button><button type="button" data-delete-impact="${entry.id}">Delete</button></div></article>`).join("");
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
      renderImpacts();
      showToast(deletion === "shared" ? "Impact entry deleted for everyone." : "Impact entry deleted on this device only.");
    }
  }));
}
function resetImpactForm() {
  const form = document.querySelector("#impact-form");
  if (!form) return;
  form.reset(); form.elements.id.value = "";
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
async function refreshSharedReports() { reports = await loadReports(); renderReportList(); renderPickupHistory(); renderMap(); }
async function refreshSharedImpacts() { impacts = await loadImpacts(); renderImpacts(); }

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  reports = readLocalReports();
  renderReportList();
  renderPickupHistory();
  renderMap();
  loadReports().then((loaded) => { reports = loaded; renderReportList(); renderPickupHistory(); renderMap(); });
  impacts = readLocalImpacts();
  renderImpacts();
  loadImpacts().then((loaded) => { impacts = loaded; renderImpacts(); });
  document.querySelector("#use-location")?.addEventListener("click", (event) => requestCurrentLocation(event.currentTarget));
  document.querySelector("#map-use-location")?.addEventListener("click", (event) => requestCurrentLocation(event.currentTarget));
  document.querySelectorAll(".filter-chip").forEach((chip) => chip.addEventListener("click", () => { document.querySelectorAll(".filter-chip").forEach((b) => b.classList.remove("active")); chip.classList.add("active"); renderReportList(chip.dataset.filter); }));
  document.querySelectorAll("[data-scroll-to]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.scrollTo)?.scrollIntoView({ behavior: "smooth" })));
  const toggle = document.querySelector("#toggle-submitted-reports"), content = document.querySelector("#submitted-reports-content");
  toggle?.addEventListener("click", () => { const expanded = toggle.getAttribute("aria-expanded") === "true"; toggle.setAttribute("aria-expanded", String(!expanded)); content.hidden = expanded; toggle.lastElementChild.textContent = expanded ? "＋" : "−"; });
  document.querySelector("#report-form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.target); const typedLocation = String(form.get("location") || "").trim();
    if (!selectedPoint && !typedLocation) return showToast("Click the map or enter a location first.");
    let image;
    try { image = await prepareReportPhoto(document.querySelector("#photo-input")?.files?.[0]); }
    catch (error) { showToast(error.message || "The selected photo could not be prepared."); return; }
    const type = form.get("type"); const report = normalizeReport({ id: Date.now(), type, title: `${type === "litter" ? "Litter" : type === "dumping" ? "Dumping" : "Environmental concern"} reported by a neighbor`, location: typedLocation || `Hamilton County map pin (${selectedPoint[0].toFixed(5)}, ${selectedPoint[1].toFixed(5)})`, status: "Needs attention", statusClass: "open", coords: selectedPoint, amount: form.get("amount"), severity: form.get("severity"), notes: form.get("notes"), date: form.get("date"), risk: form.get("risk") === "on", image });
    reports.unshift(report); if (await saveReport(report)) { renderReportList(); renderPickupHistory(); renderMap(); event.target.hidden = true; document.querySelector("#success-message").hidden = false; showToast("Report added to the Hamilton County community map."); } else reports.shift();
  });
  document.querySelector("#impact-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target), id = Number(form.get("id")) || Date.now();
    const entry = normalizeImpact({ id, cleanup_date: form.get("cleanup_date"), location: String(form.get("location") || "").trim(), bags: form.get("bags"), volunteers: form.get("volunteers"), hours: form.get("hours"), notes: String(form.get("notes") || "").trim() });
    if (!entry.location) return showToast("Add a cleanup location first.");
    const previous = impacts.findIndex((item) => item.id === id), old = previous >= 0 ? impacts[previous] : null;
    if (previous >= 0) impacts[previous] = entry; else impacts.unshift(entry);
    const saved = await saveImpact(entry);
    if (saved) {
      renderImpacts(); resetImpactForm();
      showToast(saved === "shared"
        ? (old ? "Impact entry updated for everyone." : "Impact entry shared with everyone.")
        : "Saved on this device only. Check Supabase connectivity and the latest database setup to enable sharing.");
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
  const date = document.querySelector('input[name="date"]'); if (date) date.valueAsDate = new Date();
  if (cloudReports) cloudReports.channel("hamilton-county-reports").on("postgres_changes", { event: "*", schema: "public", table: "reports" }, refreshSharedReports).subscribe();
  if (cloudReports) cloudReports.channel("hamilton-county-impacts").on("postgres_changes", { event: "*", schema: "public", table: "impact_entries" }, refreshSharedImpacts).subscribe();
});
