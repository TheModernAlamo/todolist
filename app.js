(() => {
  "use strict";

  const ACTIVE_KEY = "daymark-tasks-v1";
  const TRASH_KEY = "daymark-trash-v1";
  const statusLabels = { todo: "To do", "in-progress": "In progress", done: "Done" };
  const viewLabels = { today: "Today", upcoming: "Upcoming", all: "All tasks", calendar: "Calendar", trash: "Trash" };
  const viewDescriptions = {
    today: "Take care of today's tasks, one step at a time.",
    upcoming: "Plan ahead and stay on top of what's next.",
    all: "Manage all your tasks in one place.",
    calendar: "Review your schedule and upcoming due dates.",
    trash: "Restore deleted tasks or remove them permanently."
  };
  const byId = (id) => document.getElementById(id);
  let storageReadError = false;
  const state = {
    tasks: readTasks("localStorage", ACTIVE_KEY),
    trash: readTasks("sessionStorage", TRASH_KEY),
    view: "today",
    category: "",
    project: "",
    tag: "",
    calendarDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  };
  let noticeTimer;
  let confettiTimer;
  let pendingPurgeId = "";

  function readTasks(storageName, key) {
    try {
      const raw = window[storageName].getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new TypeError("Stored task data is not an array.");
      return parsed.filter((task) => task && typeof task.id === "string" && typeof task.title === "string");
    } catch (error) {
      storageReadError = true;
      console.error(`Could not read tasks from ${storageName}.`, error);
      return [];
    }
  }

  function persist(storageName, key, tasks) {
    try {
      window[storageName].setItem(key, JSON.stringify(tasks));
      return true;
    } catch (error) {
      console.error(`Could not save tasks to ${storageName}.`, error);
      showNotice("Could not save your changes. Check your browser storage settings.", true);
      return false;
    }
  }

  function saveTasks() {
    return persist("localStorage", ACTIVE_KEY, state.tasks);
  }

  function saveTrash() {
    return persist("sessionStorage", TRASH_KEY, state.trash);
  }

  function showNotice(message, isError = false) {
    const notice = byId("notice");
    notice.textContent = message;
    notice.classList.toggle("error", isError);
    notice.classList.add("show");
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => notice.classList.remove("show"), 2800);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function localDateString(date) {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${month}/${day}/${date.getFullYear()}`;
  }

  function parseDate(value) {
    if (!/^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/.test(value)) return null;
    const [month, day, year] = value.split("/").map(Number);
    const date = new Date(year, month - 1, day);
    if (year < 100) date.setFullYear(year);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  function dateKey(value) {
    const date = parseDate(value || "");
    if (!date) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function taskId() {
    return window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function setView(view) {
    state.view = view;
    state.category = "";
    state.project = "";
    state.tag = "";
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === view);
    });
    byId("breadcrumb-current").textContent = viewLabels[view];
    byId("page-title").textContent = viewLabels[view];
    byId("page-subtitle").textContent = viewDescriptions[view];
    byId("page-eyebrow").textContent = view === "today"
      ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date())
      : "YOUR TASKS, IN FOCUS";
    document.querySelectorAll(".filters select").forEach((select) => { select.value = ""; });
    byId("sidebar").classList.remove("open");
    byId("sidebar-scrim").classList.remove("visible");
    render();
  }

  function taskMatchesView(task) {
    const due = parseDate(task.dueDate || "");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (state.view === "today") return Boolean(due && due.getTime() === today.getTime());
    if (state.view === "upcoming") return Boolean(due && due > today);
    return true;
  }

  function getVisibleTasks() {
    const search = byId("search-input").value.trim().toLocaleLowerCase("en");
    const category = byId("category-filter").value;
    const project = byId("project-filter").value;
    const tag = byId("tag-filter").value;
    const importance = byId("importance-filter").value;
    const status = byId("status-filter").value;
    const source = state.view === "trash" ? state.trash : state.tasks;
    const filtered = source.filter((task) => {
      if (state.view !== "trash" && !taskMatchesView(task)) return false;
      if (state.category && task.category !== state.category) return false;
      if (state.project && task.project !== state.project) return false;
      if (state.tag && !(Array.isArray(task.tags) && task.tags.includes(state.tag))) return false;
      if (category && task.category !== category) return false;
      if (project && task.project !== project) return false;
      if (tag && !(Array.isArray(task.tags) && task.tags.includes(tag))) return false;
      if (status && task.status !== status) return false;
      const score = Number(task.importance) || 5;
      if (importance === "high" && score < 8) return false;
      if (importance === "medium" && (score < 4 || score > 7)) return false;
      if (importance === "low" && score > 3) return false;
      if (/^(?:[1-9]|10)$/.test(importance) && score !== Number(importance)) return false;
      if (search) {
        const searchable = [task.title, task.description, task.category, task.project, ...(Array.isArray(task.tags) ? task.tags : [])].join(" ").toLocaleLowerCase("en");
        if (!searchable.includes(search)) return false;
      }
      return true;
    });
    const sortBy = byId("sort-select").value;
    return filtered.sort((a, b) => {
      if (sortBy === "title") return a.title.localeCompare(b.title, "en");
      if (sortBy === "importance") return (Number(b.importance) || 5) - (Number(a.importance) || 5) || a.title.localeCompare(b.title, "en");
      return (dateKey(a.dueDate) || "9999-99-99").localeCompare(dateKey(b.dueDate) || "9999-99-99") || a.title.localeCompare(b.title, "en");
    });
  }

  function importanceClass(value) {
    if (value >= 8) return "importance-high";
    if (value >= 4) return "importance-medium";
    return "importance-low";
  }

  function dateMarkup(task) {
    if (!task.dueDate) return "";
    const due = parseDate(task.dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let dateClass = "";
    if (due && due < today && task.status !== "done") dateClass = "due-overdue";
    else if (due && due.getTime() === today.getTime()) dateClass = "due-today";
    const formatted = due
      ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(due)
      : task.dueDate;
    return `<span class="meta-chip ${dateClass}" title="${escapeHtml(task.dueDate)}">▣ ${escapeHtml(formatted)}</span>`;
  }

  function renderTaskCard(task, isTrash) {
    const tags = Array.isArray(task.tags) ? task.tags : [];
    const category = task.category ? `<span class="category-chip">${escapeHtml(task.category)}</span>` : "";
    const project = task.project ? `<span class="meta-chip">▰ ${escapeHtml(task.project)}</span>` : "";
    const tagMarkup = tags.map((tag) => `<span class="tag-chip"># ${escapeHtml(tag)}</span>`).join("");
    const actions = isTrash
      ? `<div class="trash-actions"><button type="button" data-action="restore" data-id="${escapeHtml(task.id)}" aria-label="Restore ${escapeHtml(task.title)}" title="Restore">↶</button><button type="button" data-action="purge" data-id="${escapeHtml(task.id)}" aria-label="Delete ${escapeHtml(task.title)} permanently" title="Delete permanently">×</button></div>`
      : `<div class="task-side"><select class="task-status" data-action="status" data-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(task.title)} status">${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}" ${task.status === value ? "selected" : ""}>${label}</option>`).join("")}</select><div class="task-actions"><button type="button" data-action="edit" data-id="${escapeHtml(task.id)}" aria-label="Edit ${escapeHtml(task.title)}" title="Edit">✎</button><button type="button" data-action="delete" data-id="${escapeHtml(task.id)}" aria-label="Move ${escapeHtml(task.title)} to trash" title="Move to trash">⌫</button></div></div>`;
    return `<article class="task-card ${task.status === "done" ? "is-done" : ""}" data-task-id="${escapeHtml(task.id)}">
      <input class="task-check" type="checkbox" data-action="toggle" data-id="${escapeHtml(task.id)}" aria-label="Mark ${escapeHtml(task.title)} complete" ${task.status === "done" ? "checked" : ""} ${isTrash ? "disabled" : ""}>
      <div class="task-main">
        <button type="button" class="task-title-button" data-action="edit" data-id="${escapeHtml(task.id)}">${escapeHtml(task.title)}</button>
        ${task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : ""}
        <div class="task-meta">${dateMarkup(task)}${category}${project}<span class="importance-chip ${importanceClass(Number(task.importance) || 5)}">⚑ Priority ${Number(task.importance) || 5}</span>${tagMarkup}</div>
      </div>
      ${actions}
    </article>`;
  }

  function renderTaskList(tasks) {
    const container = byId("task-list");
    const isTrash = state.view === "trash";
    const cards = tasks.map((task) => renderTaskCard(task, isTrash)).join("");
    container.innerHTML = `${isTrash && tasks.length ? '<div class="trash-banner">ⓘ &nbsp; Trash is cleared when your browser session ends.</div>' : ""}<div class="task-list">${cards}</div>`;
    byId("visible-count").textContent = String(tasks.length);
    byId("list-heading").textContent = state.view === "trash" ? "Recently deleted" : state.view === "today" ? "Today's tasks" : state.view === "upcoming" ? "Upcoming tasks" : "Task list";
  }

  function renderCalendar(tasks) {
    const container = byId("calendar-view");
    const year = state.calendarDate.getFullYear();
    const month = state.calendarDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const gridStart = new Date(year, month, 1 - firstDay.getDay());
    const monthLabel = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long" }).format(firstDay);
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const todayKey = dateKey(localDateString(new Date()));
    let markup = `<div class="calendar-header"><h3>${monthLabel}</h3><div class="calendar-controls"><button type="button" data-action="calendar-prev" aria-label="Previous month">‹</button><button type="button" data-action="calendar-today">Today</button><button type="button" data-action="calendar-next" aria-label="Next month">›</button></div></div><div class="calendar-weekdays">${weekdays.map((day) => `<div>${day}</div>`).join("")}</div><div class="calendar-grid">`;
    for (let index = 0; index < 42; index += 1) {
      const day = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
      const key = dateKey(localDateString(day));
      const dayTasks = tasks.filter((task) => dateKey(task.dueDate) === key);
      const classes = ["calendar-cell", day.getMonth() !== month ? "other-month" : "", key === todayKey ? "today" : ""].filter(Boolean).join(" ");
      const events = dayTasks.slice(0, 3).map((task) => `<button type="button" class="calendar-event ${task.status === "done" ? "done-event" : ""}" data-action="edit" data-id="${escapeHtml(task.id)}" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</button>`).join("");
      markup += `<div class="${classes}"><span class="calendar-day-number">${day.getDate()}</span><div class="calendar-events">${events}${dayTasks.length > 3 ? `<span class="calendar-more">+${dayTasks.length - 3} more</span>` : ""}</div></div>`;
    }
    container.innerHTML = `${markup}</div>`;
  }

  function renderCollections() {
    const source = state.view === "trash" ? state.trash : state.tasks;
    const groups = [
      { id: "category-list", key: "category", items: [...new Set(state.tasks.map((task) => task.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en")), label: "category" },
      { id: "project-list", key: "project", items: [...new Set(source.map((task) => task.project).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en")), label: "project" },
      { id: "tag-list", key: "tag", items: [...new Set(source.flatMap((task) => Array.isArray(task.tags) ? task.tags : []))].sort((a, b) => a.localeCompare(b, "en")), label: "tag" }
    ];
    groups.forEach(({ id, key, items, label }) => {
      const container = byId(id);
      if (!items.length) {
        container.innerHTML = '<span class="sidebar-empty">Nothing here yet</span>';
        return;
      }
      container.innerHTML = items.map((value) => {
        const categoryTasks = key === "category" ? state.tasks.filter((task) => task.category === value) : [];
        const count = key === "category"
          ? categoryTasks.length
          : source.filter((task) => key === "tag" ? Array.isArray(task.tags) && task.tags.includes(value) : task[key] === value).length;
        const selected = state[key] === value ? "active" : "";
        const glyph = label === "category" ? '<span class="collection-dot"></span>' : label === "project" ? '<span class="text-[13px]">▰</span>' : '<span class="text-[13px]">#</span>';
        if (key === "category") {
          const completed = categoryTasks.filter((task) => task.status === "done").length;
          const percent = count ? Math.round((completed / count) * 100) : 0;
          return `<div class="category-collection"><button type="button" class="collection-item ${selected}" data-filter="${key}" data-value="${escapeHtml(value)}">${glyph}<span class="truncate">${escapeHtml(value)}</span><span class="collection-count">${completed}/${count}</span></button><div class="category-progress-track" role="progressbar" aria-label="${escapeHtml(value)} category completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span class="category-progress-fill" style="width:${percent}%"></span></div></div>`;
        }
        return `<button type="button" class="collection-item ${selected}" data-filter="${key}" data-value="${escapeHtml(value)}">${glyph}<span class="truncate">${escapeHtml(value)}</span><span class="collection-count">${count}</span></button>`;
      }).join("");
    });
    fillFilter("category-filter", "Category", groups[0].items);
    fillFilter("project-filter", "Project", groups[1].items);
    fillFilter("tag-filter", "Tag", groups[2].items);
  }

  function fillFilter(id, label, values) {
    const select = byId(id);
    const current = select.value;
    select.innerHTML = `<option value="">${label}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
    if (values.includes(current)) select.value = current;
  }

  function renderProgress() {
    const todayTasks = state.tasks.filter(taskMatchesToday);
    const done = todayTasks.filter((task) => task.status === "done").length;
    const percent = todayTasks.length ? Math.round((done / todayTasks.length) * 100) : 0;
    byId("progress-count").textContent = `${done} of ${todayTasks.length}`;
    byId("progress-percent").textContent = `${percent}%`;
    byId("completion-summary").textContent = `${percent}%`;
    byId("progress-bar").style.width = `${percent}%`;
    byId("today-count").textContent = String(todayTasks.length);
    byId("all-count").textContent = String(state.tasks.length);
    byId("trash-count").textContent = String(state.trash.length);
  }

  function taskMatchesToday(task) {
    return dateKey(task.dueDate) === dateKey(localDateString(new Date()));
  }

  function renderEmptyState(tasks) {
    const empty = byId("empty-state");
    const isCalendar = state.view === "calendar";
    const shouldShow = tasks.length === 0 && (!isCalendar || !getCalendarTasks().length);
    empty.classList.toggle("hidden", !shouldShow);
    byId("task-list").classList.toggle("hidden", isCalendar || shouldShow);
    byId("calendar-view").classList.toggle("hidden", !isCalendar || shouldShow);
    byId("filter-controls").classList.toggle("hidden", false);
    byId("quick-add-card").classList.toggle("hidden", state.view === "trash");
    byId("progress-card").classList.toggle("hidden", state.view !== "today");
    byId("trash-note").classList.toggle("hidden", state.view !== "trash");
    byId("empty-title").textContent = state.view === "trash" ? "Your trash is empty" : state.view === "today" ? "A clear day starts here" : "Nothing to see here";
    byId("empty-description").textContent = state.view === "trash"
      ? "Deleted tasks will show up here. You can restore them whenever you need."
      : "Try adjusting your filters or add a new task to get started.";
    byId("empty-add-button").classList.toggle("hidden", state.view === "trash");
  }

  function getCalendarTasks() {
    return getVisibleTasks().filter((task) => dateKey(task.dueDate));
  }

  function render() {
    const tasks = getVisibleTasks();
    renderProgress();
    renderCollections();
    renderTaskList(tasks);
    renderCalendar(getCalendarTasks());
    renderEmptyState(tasks);
  }

  function launchConfetti(target) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const layer = byId("confetti-layer");
    const bounds = target.getBoundingClientRect();
    const originX = bounds.left + bounds.width / 2;
    const originY = bounds.top + bounds.height / 2;
    const colors = ["#28785f", "#f2b84b", "#ef7b68", "#72a8d0", "#b18bd4", "#5dbb92"];
    const fragment = document.createDocumentFragment();

    for (let index = 0; index < 36; index += 1) {
      const piece = document.createElement("span");
      const angle = (Math.PI * 2 * index) / 36 + (Math.random() - 0.5) * 0.35;
      const distance = 55 + Math.random() * 115;
      piece.className = "confetti-piece";
      piece.style.left = `${originX}px`;
      piece.style.top = `${originY}px`;
      piece.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
      piece.style.setProperty("--dy", `${Math.sin(angle) * distance + 70}px`);
      piece.style.setProperty("--spin", `${Math.random() * 720 - 360}deg`);
      piece.style.setProperty("--duration", `${700 + Math.random() * 500}ms`);
      piece.style.setProperty("--delay", `${Math.random() * 100}ms`);
      piece.style.setProperty("--piece-color", colors[Math.floor(Math.random() * colors.length)]);
      if (Math.random() > 0.5) piece.classList.add("confetti-circle");
      fragment.appendChild(piece);
    }

    layer.replaceChildren(fragment);
    window.clearTimeout(confettiTimer);
    confettiTimer = window.setTimeout(() => layer.replaceChildren(), 1500);
  }

  function resetForm() {
    byId("task-form").reset();
    byId("task-id").value = "";
    byId("task-status").value = "todo";
    byId("task-importance").value = "5";
    byId("importance-value").textContent = "5";
    ["title-error", "date-error"].forEach((id) => { byId(id).textContent = ""; });
    ["task-title", "task-due-date"].forEach((id) => byId(id).classList.remove("invalid"));
  }

  function openTaskDialog(task = null) {
    resetForm();
    byId("dialog-title").textContent = task ? "Edit task" : "Create a task";
    byId("save-task-button").textContent = task ? "Save changes" : "Save task";
    if (task) {
      byId("task-id").value = task.id;
      byId("task-title").value = task.title;
      byId("task-description").value = task.description || "";
      byId("task-due-date").value = task.dueDate || "";
      byId("task-importance").value = String(Math.min(10, Math.max(1, Number(task.importance) || 5)));
      byId("importance-value").textContent = byId("task-importance").value;
      byId("task-category").value = task.category || "";
      byId("task-project").value = task.project || "";
      byId("task-tags").value = (Array.isArray(task.tags) ? task.tags : []).join(", ");
      byId("task-status").value = task.status || "todo";
    } else if (state.view === "today") {
      byId("task-due-date").value = localDateString(new Date());
    }
    byId("task-dialog").showModal();
    byId("task-title").focus();
  }

  function validateAndBuildTask() {
    const titleInput = byId("task-title");
    const dateInput = byId("task-due-date");
    const title = titleInput.value.trim();
    const dueDate = dateInput.value.trim();
    let valid = true;
    byId("title-error").textContent = "";
    byId("date-error").textContent = "";
    titleInput.classList.remove("invalid");
    dateInput.classList.remove("invalid");
    if (!title) {
      byId("title-error").textContent = "Please enter a task title.";
      titleInput.classList.add("invalid");
      valid = false;
    }
    if (dueDate && !parseDate(dueDate)) {
      byId("date-error").textContent = "Enter a valid date in MM/DD/YYYY format.";
      dateInput.classList.add("invalid");
      valid = false;
    }
    if (!valid) return null;

    const existing = state.tasks.find((task) => task.id === byId("task-id").value);
    return {
      id: existing?.id || taskId(),
      title,
      description: byId("task-description").value.trim(),
      dueDate,
      importance: Number(byId("task-importance").value),
      category: byId("task-category").value.trim(),
      project: byId("task-project").value.trim(),
      tags: [...new Set(byId("task-tags").value.split(",").map((tag) => tag.trim()).filter(Boolean))],
      status: byId("task-status").value,
      isDeleted: false,
      createdAt: existing?.createdAt || new Date().toISOString()
    };
  }

  function addQuickTask(event) {
    event.preventDefault();
    const input = byId("quick-title");
    const title = input.value.trim();
    if (!title) {
      byId("quick-error").textContent = "Please enter a task title.";
      input.focus();
      return;
    }
    byId("quick-error").textContent = "";
    state.tasks.unshift({
      id: taskId(),
      title,
      description: "",
      dueDate: state.view === "today" ? localDateString(new Date()) : "",
      importance: 5,
      category: "",
      project: "",
      tags: [],
      status: "todo",
      isDeleted: false,
      createdAt: new Date().toISOString()
    });
    const saved = saveTasks();
    input.value = "";
    if (state.view === "trash") setView("all");
    else render();
    if (saved) showNotice("Task added.");
  }

  function moveToTrash(id) {
    const index = state.tasks.findIndex((task) => task.id === id);
    if (index < 0) return;
    const [task] = state.tasks.splice(index, 1);
    state.trash.unshift({ ...task, isDeleted: true });
    const trashSaved = saveTrash();
    if (!trashSaved) {
      state.trash.shift();
      state.tasks.splice(index, 0, task);
      render();
      return;
    }
    const activeSaved = saveTasks();
    render();
    if (activeSaved) showNotice("Task moved to Trash.");
  }

  function restoreTask(id) {
    const index = state.trash.findIndex((task) => task.id === id);
    if (index < 0) return;
    const [task] = state.trash.splice(index, 1);
    state.tasks.unshift({ ...task, isDeleted: false });
    const activeSaved = saveTasks();
    const trashSaved = saveTrash();
    render();
    if (activeSaved && trashSaved) showNotice("Task restored.");
  }

  function handleAction(action, id, target) {
    const task = state.tasks.find((item) => item.id === id);
    switch (action) {
      case "new-task":
        openTaskDialog();
        break;
      case "edit":
        if (task) openTaskDialog(task);
        break;
      case "delete":
        moveToTrash(id);
        break;
      case "restore":
        restoreTask(id);
        break;
      case "purge": {
        const taskToDelete = state.trash.find((item) => item.id === id);
        if (!taskToDelete) break;
        pendingPurgeId = id;
        byId("delete-confirm-task").textContent = `"${taskToDelete.title}"`;
        byId("delete-confirm-dialog").showModal();
        break;
      }
      case "confirm-purge": {
        const taskIdToPurge = pendingPurgeId;
        pendingPurgeId = "";
        byId("delete-confirm-dialog").close();
        const previousLength = state.trash.length;
        state.trash = state.trash.filter((item) => item.id !== taskIdToPurge);
        if (state.trash.length !== previousLength) {
          const saved = saveTrash();
          render();
          if (saved) showNotice("Task permanently deleted.");
        }
        break;
      }
      case "cancel-purge":
        pendingPurgeId = "";
        byId("delete-confirm-dialog").close();
        break;
      case "toggle":
        if (task) {
          const wasDone = task.status === "done";
          task.status = target.checked ? "done" : "todo";
          const saved = saveTasks();
          if (saved && !wasDone && task.status === "done") launchConfetti(target);
          render();
          if (saved) showNotice(task.status === "done" ? "Task completed." : "Task marked as to do.");
        }
        break;
      case "status":
        if (task) {
          const wasDone = task.status === "done";
          task.status = target.value;
          const saved = saveTasks();
          if (saved && !wasDone && task.status === "done") launchConfetti(target);
          render();
          if (saved) showNotice(`Status changed to "${statusLabels[target.value]}".`);
        }
        break;
      case "calendar-prev":
        state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() - 1, 1);
        render();
        break;
      case "calendar-next":
        state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + 1, 1);
        render();
        break;
      case "calendar-today":
        state.calendarDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        render();
        break;
      case "close-dialog":
        byId("task-dialog").close();
        break;
      default:
        break;
    }
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action], [data-view], [data-filter]");
    if (!target) return;
    if (target.dataset.view) {
      event.preventDefault();
      setView(target.dataset.view);
      return;
    }
    if (target.dataset.filter) {
      const key = target.dataset.filter;
      state[key] = state[key] === target.dataset.value ? "" : target.dataset.value;
      const select = byId(`${key}-filter`);
      if (select) select.value = "";
      render();
      return;
    }
    if (target.dataset.action) {
      if (target.dataset.action === "status" || target.dataset.action === "toggle") return;
      event.preventDefault();
      handleAction(target.dataset.action, target.dataset.id, target);
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target.matches('[data-action="status"]')) handleAction("status", target.dataset.id, target);
    if (target.matches('[data-action="toggle"]')) handleAction("toggle", target.dataset.id, target);
  });

  byId("task-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const task = validateAndBuildTask();
    if (!task) return;
    const existingIndex = state.tasks.findIndex((item) => item.id === task.id);
    const wasDone = existingIndex >= 0 && state.tasks[existingIndex].status === "done";
    if (existingIndex >= 0) state.tasks[existingIndex] = task;
    else state.tasks.unshift(task);
    const saved = saveTasks();
    if (saved && task.status === "done" && !wasDone) launchConfetti(byId("save-task-button"));
    byId("task-dialog").close();
    if (state.view === "trash") setView("all");
    else render();
    if (saved) showNotice(existingIndex >= 0 ? "Task updated." : "Task added.");
  });

  byId("quick-add-form").addEventListener("submit", addQuickTask);
  byId("quick-title").addEventListener("input", () => { byId("quick-error").textContent = ""; });
  byId("task-title").addEventListener("input", () => {
    if (byId("task-title").value.trim()) {
      byId("title-error").textContent = "";
      byId("task-title").classList.remove("invalid");
    }
  });
  byId("task-due-date").addEventListener("input", () => {
    byId("date-error").textContent = "";
    byId("task-due-date").classList.remove("invalid");
  });
  byId("task-importance").addEventListener("input", (event) => {
    byId("importance-value").textContent = event.target.value;
  });
  ["search-input", "category-filter", "project-filter", "tag-filter", "importance-filter", "status-filter", "sort-select"].forEach((id) => {
    byId(id).addEventListener(id === "search-input" ? "input" : "change", () => {
      const filterKey = { "category-filter": "category", "project-filter": "project", "tag-filter": "tag" }[id];
      if (filterKey) state[filterKey] = "";
      render();
    });
  });

  byId("menu-toggle").addEventListener("click", () => {
    byId("sidebar").classList.toggle("open");
    byId("sidebar-scrim").classList.toggle("visible");
  });
  byId("sidebar-scrim").addEventListener("click", () => {
    byId("sidebar").classList.remove("open");
    byId("sidebar-scrim").classList.remove("visible");
  });
  byId("task-dialog").addEventListener("click", (event) => {
    if (event.target === byId("task-dialog")) byId("task-dialog").close();
  });
  byId("delete-confirm-dialog").addEventListener("click", (event) => {
    if (event.target === byId("delete-confirm-dialog")) {
      pendingPurgeId = "";
      byId("delete-confirm-dialog").close();
    }
  });
  byId("delete-confirm-dialog").addEventListener("close", () => {
    pendingPurgeId = "";
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
      event.preventDefault();
      byId("search-input").focus();
    }
    if (event.key.toLowerCase() === "n" && !event.metaKey && !event.ctrlKey && !event.altKey && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
      event.preventDefault();
      openTaskDialog();
    }
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    if (button.dataset.view === "today") button.classList.add("active");
  });
  byId("page-eyebrow").textContent = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  render();
  if (storageReadError) showNotice("Saved task data could not be read. Check the browser console for details.", true);
})();
