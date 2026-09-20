const reportsStorageKey = "clean-westfield-submitted-reports";
const supabaseSettings = window.CLEAN_WESTFIELD_SUPABASE || {};
const cloudReports = supabaseSettings.url && supabaseSettings.anonKey && window.supabase
  ? window.supabase.createClient(supabaseSettings.url, supabaseSettings.anonKey)
  : null;
let reports = [];

function normalizeReport(report) {
  return {
    ...report,
    status: report.status || "Needs attention",
    statusClass: report.statusClass || report.status_class || "open",
    image: report.image || "https://images.unsplash.com/photo-1501854140801-50d01698950b?auto=format&fit=crop&w=600&q=85",
    pickedUp: report.pickedUp === true || report.picked_up === true,
    pickedUpAt: report.pickedUpAt || report.picked_up_at || "",
  };
}

function fromCloudReport(report) {
  return normalizeReport({
    ...report,
    statusClass: report.status_class,
    pickedUp: report.picked_up,
    pickedUpAt: report.picked_up_at,
  });
}

function toCloudReport(report) {
  return {
    id: report.id,
    type: report.type,
    title: report.title,
    location: report.location,
    status: report.status,
    status_class: report.statusClass,
    coords: report.coords,
    amount: report.amount,
    severity: report.severity,
    notes: report.notes,
    date: report.date || null,
    risk: report.risk === true,
    image: report.image,
    picked_up: report.pickedUp === true,
    picked_up_at: report.pickedUpAt || null,
  };
}

async function loadReports() {
  if (cloudReports) {
    const { data, error } = await cloudReports.from("reports").select("*").order("created_at", { ascending: false });
    if (error) {
      console.error("Unable to load shared Clean Westfield reports.", error);
      showToast("Shared reports could not be loaded. Showing this device's saved reports.");
    } else {
      return (data || []).map(fromCloudReport);
    }
  }
  try {
    const saved = JSON.parse(localStorage.getItem(reportsStorageKey) || "[]");
    if (!Array.isArray(saved)) return [];
    return saved
      .filter((report) => report && typeof report === "object" && report.id && report.type && report.location)
      .map(normalizeReport);
  } catch (error) {
    console.error("Unable to load saved Clean Westfield reports.", error);
    return [];
  }
}
async function saveReport(report) {
  if (cloudReports) {
    const { error } = await cloudReports.from("reports").upsert(toCloudReport(report));
    if (error) {
      console.error("Unable to save shared Clean Westfield report.", error);
      showToast("The shared report could not be saved.");
      return false;
    }
    return true;
  }
  try {
    localStorage.setItem(reportsStorageKey, JSON.stringify(reports));
    return true;
  } catch (error) {
    console.error("Unable to save Clean Westfield report.", error);
    showToast("This report could not be saved in this browser.");
    return false;
  }
}
async function deleteReport(reportId) {
  if (cloudReports) {
    const { error } = await cloudReports.from("reports").delete().eq("id", reportId);
    if (error) {
      console.error("Unable to delete shared pickup history.", error);
      showToast("This pickup history record could not be deleted.");
      return false;
    }
    return true;
  }
  return true;
}

loadReports().then((loadedReports) => {
  reports = loadedReports;
  renderReportList();
  renderPickupHistory();
});

let selectedPoint = null;

function renderReportList(filter = "all") {
  const list = document.querySelector("#report-list");
  if (!list) return;
  const activeReports = reports.filter((report) => !report.pickedUp);
  const visibleReports = activeReports
    .filter((report) => filter === "all" || report.type === filter)
    .slice(0, 8);
  list.innerHTML = visibleReports
    .map((report) => `<div class="report-item" data-report-id="${report.id}">
      <div class="report-thumb" style="background-image:url('${report.image}')"></div>
      <div class="report-info"><div class="report-title">${report.title}</div><div class="report-meta">${report.location}</div><span class="report-status status-${report.statusClass}">${report.status}</span></div>
      <label class="pickup-check"><input type="checkbox" data-pickup-id="${report.id}" /> Picked up</label>
    </div>`).join("");
  const emptyReports = document.querySelector("#empty-reports");
  if (emptyReports) emptyReports.hidden = visibleReports.length > 0;
  list.querySelectorAll(".report-item").forEach((item) => item.addEventListener("click", (event) => {
    if (event.target.closest(".pickup-check")) return;
    const report = reports.find((entry) => entry.id === Number(item.dataset.reportId));
    showToast(`${report.title} · ${report.location}`);
  }));
  list.querySelectorAll("[data-pickup-id]").forEach((checkbox) => checkbox.addEventListener("click", (event) => {
    event.stopPropagation();
    const report = reports.find((entry) => String(entry.id) === checkbox.dataset.pickupId);
    if (!report) return;
    report.pickedUp = checkbox.checked;
    report.pickedUpAt = checkbox.checked ? new Date().toISOString() : "";
    report.status = checkbox.checked ? "Picked up" : "Needs attention";
    report.statusClass = checkbox.checked ? "resolved" : "open";
    saveReport(report).then((saved) => {
      if (!saved) return;
    });
    renderReportList(filter);
    renderPickupHistory();
    showToast(checkbox.checked ? "Removed from active reports. Location history kept." : "Report returned to active reports.");
  }));
}

function formatReportDate(value, fallback = "Date not provided") {
  if (!value) return fallback;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function renderPickupHistory() {
  const list = document.querySelector("#pickup-history-list");
  const empty = document.querySelector("#pickup-history-empty");
  if (!list || !empty) return;
  const completed = reports.filter((report) => report.pickedUp);
  list.innerHTML = completed.map((report) => {
    const pickedUpDate = report.pickedUpAt ? new Date(report.pickedUpAt).toLocaleDateString() : "Date not recorded";
    return `<article class="pickup-history-item" data-history-id="${report.id}">
      <div>
        <strong>${report.title}</strong>
        <p><span class="history-meta">Location:</span> ${report.location}<br />
        <span class="history-meta">Original report:</span> ${formatReportDate(report.date)} ·
        <span class="history-meta">Picked up:</span> ${pickedUpDate}<br />
        <span class="history-meta">Category:</span> ${report.type} · <span class="history-meta">Notes:</span> ${report.notes || "None"}</p>
      </div>
      <button class="delete-history-button" type="button" data-delete-history="${report.id}">Permanently delete</button>
    </article>`;
  }).join("");
  empty.hidden = completed.length > 0;
  list.querySelectorAll("[data-delete-history]").forEach((button) => button.addEventListener("click", () => {
    const report = reports.find((entry) => String(entry.id) === button.dataset.deleteHistory);
    if (!report || !window.confirm("Permanently delete this pickup history record?")) return;
    deleteReport(report.id).then((deleted) => {
      if (!deleted) return;
      reports.splice(reports.indexOf(report), 1);
      if (!cloudReports) saveReport(reports);
      renderPickupHistory();
      showToast("Pickup history record permanently deleted.");
    });
  }));
}

renderReportList();
renderPickupHistory();

const reportsToggle = document.querySelector("#toggle-submitted-reports");
const reportsContent = document.querySelector("#submitted-reports-content");
if (reportsToggle && reportsContent) {
  reportsToggle.addEventListener("click", () => {
    const expanded = reportsToggle.getAttribute("aria-expanded") === "true";
    reportsToggle.setAttribute("aria-expanded", String(!expanded));
    reportsContent.hidden = expanded;
    reportsToggle.lastElementChild.textContent = expanded ? "＋" : "−";
  });
}

document.querySelectorAll(".filter-chip").forEach((chip) => chip.addEventListener("click", () => {
  document.querySelectorAll(".filter-chip").forEach((button) => button.classList.remove("active"));
  chip.classList.add("active");
  renderReportList(chip.dataset.filter);
}));
function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3500);
}

function showLocationOnGoogleMap(position) {
  const { latitude, longitude } = position.coords;
  const map = document.querySelector(".google-map");
  if (map) {
    map.src = `https://www.google.com/maps?q=${latitude},${longitude}&z=16&output=embed`;
  }
}

function requestCurrentLocation(button) {
  if (!navigator.geolocation) return showToast("Location services are not available in this browser.");
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  }
  showToast("Requesting your location…");
  navigator.geolocation.getCurrentPosition((position) => {
    selectedPoint = [position.coords.latitude, position.coords.longitude];
    showLocationOnGoogleMap(position);
    document.querySelector("#location-input").value = `Your location (${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)})`;
    document.querySelector("#selected-location").hidden = false;
    showToast("Your location is shown on the map and ready to use in the report.");
    if (button) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }, (error) => {
    const message = error.code === 1
      ? "Location access was denied. Allow it in your browser and try again."
      : "Location took too long to respond. Try again or use the report location field.";
    showToast(message);
    if (button) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }, { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 });
}

const formLocationButton = document.querySelector("#use-location");
if (formLocationButton) {
  formLocationButton.addEventListener("click", (event) => {
    requestCurrentLocation(event.currentTarget);
  });
}
const mapLocationButton = document.querySelector("#map-use-location");
if (mapLocationButton) {
  mapLocationButton.addEventListener("click", (event) => {
    requestCurrentLocation(event.currentTarget);
  });
}

document.querySelectorAll("[data-scroll-to]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.scrollTo).scrollIntoView({ behavior: "smooth", block: "start" })));
const reportForm = document.querySelector("#report-form");
if (reportForm) reportForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  if (!selectedPoint && !String(form.get("location") || "").trim()) {
    showToast("Enter a location or use your current location first.");
    document.querySelector("#report-panel").scrollIntoView({ behavior: "smooth" });
    return;
  }
  const newReport = {
    id: Date.now(), type: form.get("type"), title: `${form.get("type") === "litter" ? "Litter" : form.get("type") === "dumping" ? "Dumping" : "Environmental concern"} reported by a neighbor`,
    location: form.get("location"), status: "Needs attention", statusClass: "open", coords: selectedPoint || "user-entered",
    amount: form.get("amount"), severity: form.get("severity"), notes: form.get("notes"), date: form.get("date"), risk: form.get("risk") === "on",
    image: "https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=600&q=85",
  };
  reports.unshift(newReport);
  saveReport(newReport).then((saved) => {
    if (!saved) {
      reports.shift();
      return;
    }
  renderReportList();
  renderPickupHistory();
  event.target.hidden = true;
  document.querySelector("#success-message").hidden = false;
  showToast("Report added to the community map.");
  });
});

const photoInput = document.querySelector("#photo-input");
if (photoInput) photoInput.addEventListener("change", (event) => {
  if (event.target.files.length) showToast(`${event.target.files[0].name} attached to your report.`);
});

const dateInput = document.querySelector('input[name="date"]');
if (dateInput) dateInput.valueAsDate = new Date();
