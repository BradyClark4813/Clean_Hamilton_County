const reportsStorageKey = "clean-westfield-submitted-reports";
function loadReports() {
  try {
    const saved = JSON.parse(localStorage.getItem(reportsStorageKey) || "[]");
    if (!Array.isArray(saved)) return [];
    return saved
      .filter((report) => report && typeof report === "object" && report.id && report.type && report.location)
      .map((report) => ({
        ...report,
        title: report.title || "Environmental concern reported by a neighbor",
        status: report.status || "Needs attention",
        statusClass: report.statusClass || "open",
        image: report.image || "https://images.unsplash.com/photo-1501854140801-50d01698950b?auto=format&fit=crop&w=600&q=85",
      }));
  } catch (error) {
    console.error("Unable to load saved Clean Westfield reports.", error);
    return [];
  }
}
function saveReports() {
  try {
    localStorage.setItem(reportsStorageKey, JSON.stringify(reports));
    return true;
  } catch (error) {
    console.error("Unable to save Clean Westfield report.", error);
    showToast("This report could not be saved in this browser.");
    return false;
  }
}
const reports = loadReports();

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
    report.status = checkbox.checked ? "Picked up" : "Needs attention";
    report.statusClass = checkbox.checked ? "resolved" : "open";
    saveReports();
    renderReportList(filter);
    showToast(checkbox.checked ? "Removed from active reports. Location history kept." : "Report returned to active reports.");
  }));
}

renderReportList();

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
  if (!saveReports()) return;
  renderReportList();
  event.target.hidden = true;
  document.querySelector("#success-message").hidden = false;
  showToast("Report added to the community map.");
});

const photoInput = document.querySelector("#photo-input");
if (photoInput) photoInput.addEventListener("change", (event) => {
  if (event.target.files.length) showToast(`${event.target.files[0].name} attached to your report.`);
});

const dateInput = document.querySelector('input[name="date"]');
if (dateInput) dateInput.valueAsDate = new Date();

const drawCircleButton = document.querySelector("#draw-circle");
const circleLocationButton = document.querySelector("#circle-use-location");
if (circleLocationButton) {
  circleLocationButton.addEventListener("click", () => {
    if (!navigator.geolocation) {
      showToast("Location services are not available in this browser.");
      return;
    }
    circleLocationButton.disabled = true;
    navigator.geolocation.getCurrentPosition((position) => {
      const input = document.querySelector("#circle-location");
      input.value = `Your location (${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)})`;
      showLocationOnGoogleMap(position);
      circleLocationButton.disabled = false;
      showToast("Your location is ready for a radius circle.");
    }, () => {
      circleLocationButton.disabled = false;
      showToast("We could not access your location. Enter a place instead.");
    }, { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 });
  });
}
if (drawCircleButton) {
  drawCircleButton.addEventListener("click", () => {
    const locationInput = document.querySelector("#circle-location");
    const radiusInput = document.querySelector("#circle-radius");
    const visual = document.querySelector("#radius-visual");
    const circle = document.querySelector("#radius-circle");
    const title = document.querySelector("#radius-title");
    const detail = document.querySelector("#radius-detail");
    const location = locationInput.value.trim();
    const radius = radiusInput.value;
    if (!location) {
      showToast("Enter a place or landmark first.");
      locationInput.focus();
      return;
    }
    circle.textContent = `${Number(radius).toLocaleString()} ft`;
    title.textContent = `Trash area near ${location}`;
    detail.textContent = `Approximate ${Number(radius).toLocaleString()} ft community-marked radius`;
    visual.hidden = false;
    const map = document.querySelector(".google-map");
    if (map) map.src = `https://www.google.com/maps?q=${encodeURIComponent(location + ", Westfield, Indiana")}&output=embed`;
  });
}
