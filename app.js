(() => {
  "use strict";

  const ACTIVE_STORAGE_KEY = "daymark-tasks-v1";
  const TRASH_STORAGE_KEY = "daymark-trash-v1";
  const statusLabels = { todo: "To do", "in-progress": "In progress", done: "Done" };
  const viewLabels = { today: "Today", upcoming: "Upcoming", all: "All tasks", calendar: "Calendar", trash: "Trash" };
  const today = new Date();
  const state = {
    tasks: readTasks(ACTIVE_STORAGE_KEY, "localStorage"),
    trash: readTasks(TRASH_STORAGE_KEY, "sessionStorage"),
    view: "today",
    category: "",
    project: "",
    tag: "",
    calendarDate: new Date(today.getFullYear(), today.getMonth(), 1)
  };

  const byId = (id) => document.getElementById(id);
  const taskModal = new bootstrap.Modal(byId("task-modal"));
  let noticeTimer;

  function readTasks(key, storageName) {
    try {
      const raw = window[storageName].getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new TypeError("Stored task data is not an array.");
      return parsed.filter((task) => task && typeof task.id === "string" && typeof task.title === "string");
    } catch (error) {
      console.error(`Failed to load tasks from ${storageName}.`, error);
      window.setTimeout(() => showNotice("Could not load saved tasks.", true), 0);
      return [];
    }
  }

  function persist(storageName, key, tasks) {
    try {
      window[storageName].setItem(key, JSON.stringify(tasks));
      return true;
    } catch (error) {
      console.error(`Failed to save tasks to ${storageName}.`, error);
      showNotice("Could not save your changes. Check your browser storage.", true);
      return false;
    }
  }

  function saveTasks() {
    return persist("localStorage", ACTIVE_STORAGE_KEY, state.tasks);
  }

  function saveTrash() {
    return persist("sessionStorage", TRASH_STORAGE_KEY, state.trash);
  }

  function showNotice(message, isError = false) {
    const notice = byId("notice");
    notice.textContent = message;
    notice.classList.toggle("error", isError);
    notice.classList.add("show");
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => notice.classList.remove("show"), 2800);
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
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  function dateKey(value) {
    const date = parseDate(value);
    if (!date) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function parseDueDateTime(task) {
    const date = parseDate(task.dueDate || "");
    if (!date) return null;
    const time = task.dueTime || "";
    if (!time) {
      date.setHours(23, 59, 59, 999);
      return date;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
    const [hours, minutes] = time.split(":").map(Number);
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  function hasTag(task, value) {
    return Array.isArray(task.tags) && task.tags.includes(value);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
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
    const subtitles = {
      today: "Take care of today's tasks, one step at a time.",
      upcoming: "Plan ahead and stay on top of what's next.",
      all: "Manage all your tasks in one place.",
      calendar: "Review your schedule and upcoming due dates.",
      trash: "Restore deleted tasks or remove them permanently."
    };
    byId("page-subtitle").textContent = subtitles[view];
    document.querySelectorAll(".filters select").forEach((select) => { select.value = ""; });
    render();
  }

  function taskMatchesView(task) {
    if (state.view === "trash") return false;
    const due = parseDate(task.dueDate || "");
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    if (state.view === "today") return Boolean(due && due.getTime() === todayDate.getTime());
    if (state.view === "upcoming") {
      if (!due) return false;
      if (due > todayDate) return true;
      if (due.getTime() !== todayDate.getTime() || !task.dueTime) return false;
      const dueDateTime = parseDueDateTime(task);
      return Boolean(dueDateTime && dueDateTime > new Date());
    }
    return true;
  }

  function getVisibleTasks() {
    const search = byId("search-input").value.trim().toLocaleLowerCase();
    const category = byId("category-filter").value;
    const project = byId("project-filter").value;
    const tag = byId("tag-filter").value;
    const importance = byId("importance-filter").value;
    const status = byId("status-filter").value;
    const activeTasks = state.view === "trash" ? state.trash : state.tasks;
    const filtered = activeTasks.filter((task) => {
      if (state.view !== "trash" && !taskMatchesView(task)) return false;
      if (state.category && task.category !== state.category) return false;
      if (state.project && task.project !== state.project) return false;
      if (state.tag && !hasTag(task, state.tag)) return false;
      if (category && task.category !== category) return false;
      if (project && task.project !== project) return false;
      if (tag && !hasTag(task, tag)) return false;
      if (status && task.status !== status) return false;
      if (importance === "high" && task.importance < 8) return false;
      if (importance === "medium" && (task.importance < 4 || task.importance > 7)) return false;
      if (importance === "low" && task.importance > 3) return false;
      if (/^(?:[1-9]|10)$/.test(importance) && Number(task.importance) !== Number(importance)) return false;
      if (search) {
        const haystack = [task.title, task.description, task.category, task.project, ...(Array.isArray(task.tags) ? task.tags : [])].join(" ").toLocaleLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
    const sortBy = byId("sort-select").value;
    return filtered.sort((a, b) => {
      if (sortBy === "title") return a.title.localeCompare(b.title, "en");
      if (sortBy === "importance") return b.importance - a.importance || a.title.localeCompare(b.title, "en");
      const dateA = dateKey(a.dueDate) || "9999-99-99";
      const dateB = dateKey(b.dueDate) || "9999-99-99";
      const timeA = a.dueTime || "23:59";
      const timeB = b.dueTime || "23:59";
      return dateA.localeCompare(dateB) || timeA.localeCompare(timeB) || b.importance - a.importance;
    });
  }

  function getImportanceClass(value) {
    if (value >= 8) return "importance-high";
    if (value >= 4) return "importance-medium";
    return "importance-low";
  }

  function formatDueTime(task) {
    const due = parseDueDateTime(task);
    return task.dueTime && due
      ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(due)
      : "";
  }

  function dateDescription(task) {
    if (!task.dueDate) return "";
    const due = parseDueDateTime(task);
    const now = new Date();
    let dateClass = "";
    if (due) {
      if (due.getTime() < now.getTime() && task.status !== "done") dateClass = "due-overdue";
      else if (dateKey(task.dueDate) === dateKey(localDateString(now))) dateClass = "due-today";
    }
    const formattedTime = formatDueTime(task);
    const timeLabel = formattedTime ? ` · ${formattedTime}` : "";
    return `<span class="meta-chip ${dateClass}"><i class="bi bi-calendar-event"></i>${escapeHtml(task.dueDate)}${timeLabel}</span>`;
  }

  function renderTaskCard(task, isTrash = false) {
    const tags = Array.isArray(task.tags) ? task.tags : [];
    const category = task.category ? `<span class="category-chip">${escapeHtml(task.category)}</span>` : "";
    const project = task.project ? `<span class="meta-chip"><i class="bi bi-folder2"></i>${escapeHtml(task.project)}</span>` : "";
    const tagMarkup = tags.map((tag) => `<span class="tag-chip"># ${escapeHtml(tag)}</span>`).join("");
    const statusControl = isTrash
      ? `<div class="trash-actions"><button type="button" data-action="restore" data-id="${escapeHtml(task.id)}" aria-label="Restore task" title="Restore"><i class="bi bi-arrow-counterclockwise"></i></button><button type="button" data-action="purge" data-id="${escapeHtml(task.id)}" aria-label="Delete permanently" title="Delete permanently"><i class="bi bi-x-lg"></i></button></div>`
      : `<div class="task-side"><select class="form-select task-status" data-action="status" data-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(task.title)} status">${Object.entries(statusLabels).map(([key, label]) => `<option value="${key}" ${task.status === key ? "selected" : ""}>${label}</option>`).join("")}</select><div class="task-actions"><button type="button" data-action="edit" data-id="${escapeHtml(task.id)}" aria-label="Edit task" title="Edit"><i class="bi bi-pencil"></i></button><button type="button" data-action="delete" data-id="${escapeHtml(task.id)}" aria-label="Move to trash" title="Delete"><i class="bi bi-trash3"></i></button></div></div>`;
    const taskMainAction = isTrash ? "" : `data-action="edit" data-id="${escapeHtml(task.id)}" tabindex="0" role="button" aria-label="View details for ${escapeHtml(task.title)}"`;
    return `<article class="task-card ${task.status === "done" ? "is-done" : ""}" data-task-id="${escapeHtml(task.id)}">
      <input class="task-check" type="checkbox" data-action="toggle" data-id="${escapeHtml(task.id)}" aria-label="Complete ${escapeHtml(task.title)}" ${task.status === "done" ? "checked" : ""} ${isTrash ? "disabled" : ""}>
      <div class="task-main" ${taskMainAction}>
        <span class="task-title">${escapeHtml(task.title)}</span>
        ${task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : ""}
        <div class="task-meta">${dateDescription(task)}${category}${project}<span class="importance-chip ${getImportanceClass(task.importance)}"><i class="bi bi-flag-fill"></i> Priority ${Number(task.importance) || 5}</span>${tagMarkup}</div>
      </div>
      ${statusControl}
    </article>`;
  }

  function renderTaskList(tasks) {
    const list = byId("task-list");
    const isTrash = state.view === "trash";
    list.innerHTML = "";
    if (isTrash && tasks.length) {
      const banner = document.createElement("div");
      banner.className = "trash-banner";
      banner.innerHTML = '<i class="bi bi-info-circle"></i><span>Trash is cleared when your browser session ends.</span>';
      list.appendChild(banner);
    }
    const cards = document.createElement("div");
    cards.className = "task-list";
    cards.innerHTML = tasks.map((task) => renderTaskCard(task, isTrash)).join("");
    list.appendChild(cards);
    byId("visible-count").textContent = String(tasks.length);
    byId("list-heading").textContent = state.view === "trash" ? "Trash" : state.view === "today" ? "Today's tasks" : state.view === "upcoming" ? "Upcoming tasks" : "Task list";
  }

  function renderCalendar() {
    const container = byId("calendar-view");
    const year = state.calendarDate.getFullYear();
    const month = state.calendarDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDay = firstDay.getDay();
    const gridStart = new Date(year, month, 1 - startDay);
    const monthLabel = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long" }).format(firstDay);
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const calendarTasks = getVisibleTasks();
    let markup = `<div class="calendar-header"><h3>${monthLabel}</h3><div class="calendar-controls"><button type="button" data-action="calendar-prev" aria-label="Previous month"><i class="bi bi-chevron-left"></i></button><button type="button" data-action="calendar-today">Today</button><button type="button" data-action="calendar-next" aria-label="Next month"><i class="bi bi-chevron-right"></i></button></div></div><div class="calendar-weekdays">${weekdays.map((day) => `<div>${day}</div>`).join("")}</div><div class="calendar-grid">`;
    const todayKey = dateKey(localDateString(new Date()));
    for (let index = 0; index < 42; index += 1) {
      const day = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
      const key = dateKey(localDateString(day));
      const dayTasks = calendarTasks.filter((task) => dateKey(task.dueDate || "") === key);
      const classes = ["calendar-cell", day.getMonth() !== month ? "other-month" : "", key === todayKey ? "today" : ""].filter(Boolean).join(" ");
      markup += `<div class="${classes}"><span class="calendar-day-number">${day.getDate()}</span>${dayTasks.slice(0, 3).map((task) => {
        const time = formatDueTime(task);
        const label = `${time ? `${time} · ` : ""}${task.title}`;
        return `<button type="button" class="calendar-event ${task.status === "done" ? "done-event" : ""}" data-action="edit" data-id="${escapeHtml(task.id)}" title="${escapeHtml(label)}">${escapeHtml(label)}</button>`;
      }).join("")}${dayTasks.length > 3 ? `<span class="meta-chip">+${dayTasks.length - 3} more</span>` : ""}</div>`;
    }
    container.innerHTML = `${markup}</div>`;
  }

  function renderCollections() {
    const activeTasks = state.view === "trash" ? state.trash : state.tasks;
    const selectedCategory = byId("category-filter").value;
    const selectedProject = byId("project-filter").value;
    const selectedTag = byId("tag-filter").value;
    const groups = [
      { id: "category-list", key: "category", values: [...new Set(activeTasks.map((task) => task.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en")), icon: "collection-dot" },
      { id: "project-list", key: "project", values: [...new Set(activeTasks.map((task) => task.project).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en")), icon: "bi bi-folder2" },
      { id: "tag-list", key: "tag", values: [...new Set(activeTasks.flatMap((task) => Array.isArray(task.tags) ? task.tags : []))].sort((a, b) => a.localeCompare(b, "en")), icon: "bi bi-hash" }
    ];
    groups.forEach(({ id, key, values, icon }) => {
      const container = byId(id);
      if (!values.length) {
        container.innerHTML = '<span class="sidebar-empty">Nothing here yet</span>';
        return;
      }
      container.innerHTML = values.map((value) => {
        const count = activeTasks.filter((task) => key === "tag" ? hasTag(task, value) : task[key] === value).length;
        const selected = state[key] === value ? "active" : "";
        const iconMarkup = icon.includes("bi ") ? `<i class="${icon}"></i>` : `<span class="${icon}"></span>`;
        return `<button type="button" class="${selected}" data-filter="${key}" data-value="${escapeHtml(value)}">${iconMarkup}<span>${escapeHtml(value)}</span><span class="collection-count">${count}</span></button>`;
      }).join("");
    });
    const categories = groups[0].values;
    const projects = groups[1].values;
    byId("category-filter").innerHTML = `<option value="">All categories</option>${categories.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
    byId("project-filter").innerHTML = `<option value="">All projects</option>${projects.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
    byId("tag-filter").innerHTML = `<option value="">All tags</option>${groups[2].values.map((value) => `<option value="${escapeHtml(value)}"># ${escapeHtml(value)}</option>`).join("")}`;
    byId("category-filter").value = categories.includes(selectedCategory) ? selectedCategory : "";
    byId("project-filter").value = projects.includes(selectedProject) ? selectedProject : "";
    byId("tag-filter").value = groups[2].values.includes(selectedTag) ? selectedTag : "";
    byId("category-options").innerHTML = categories.map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");
    byId("project-options").innerHTML = projects.map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");
  }

  function renderSummary() {
    const active = state.tasks;
    const completed = active.filter((task) => task.status === "done").length;
    const todayKey = dateKey(localDateString(new Date()));
    const todayTasks = active.filter((task) => dateKey(task.dueDate || "") === todayKey).length;
    const rate = active.length ? Math.round((completed / active.length) * 100) : 0;
    byId("summary-total").textContent = String(active.length);
    byId("summary-today").textContent = String(todayTasks);
    byId("summary-progress").textContent = String(active.filter((task) => task.status === "in-progress").length);
    byId("summary-rate").textContent = `${rate}%`;
    byId("summary-completed").textContent = `${completed} ${completed === 1 ? "task" : "tasks"} completed`;
    byId("completion-progress").style.width = `${rate}%`;
    byId("completion-progress").parentElement.setAttribute("aria-valuenow", String(rate));
    byId("today-count").textContent = String(todayTasks);
    byId("all-count").textContent = String(active.length);
    byId("trash-count").textContent = String(state.trash.length);
  }

  function renderEmptyState(tasks) {
    const empty = byId("empty-state");
    const isCalendar = state.view === "calendar";
    const isTrash = state.view === "trash";
    const isEmpty = tasks.length === 0;
    empty.classList.toggle("d-none", !isEmpty);
    byId("empty-add").classList.toggle("d-none", isTrash || isCalendar);
    byId("empty-title").textContent = isTrash ? "Your trash is empty" : isCalendar ? "No tasks to show on the calendar" : state.view === "today" ? "Nothing is due today" : "No tasks to show";
    byId("empty-description").textContent = isTrash ? "Deleted tasks will appear here." : "Add a task or adjust your filters.";
  }

  function render() {
    byId("today-date").textContent = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
    renderSummary();
    renderCollections();
    const tasks = getVisibleTasks();
    renderTaskList(tasks);
    renderCalendar();
    const calendar = state.view === "calendar";
    byId("calendar-view").classList.toggle("d-none", !calendar);
    byId("task-list").classList.toggle("d-none", calendar);
    byId("empty-state").classList.add("d-none");
    renderEmptyState(tasks);
  }

  function clearFormErrors() {
    byId("title-error").textContent = "";
    byId("date-error").textContent = "";
    byId("time-error").textContent = "";
    byId("task-title").classList.remove("is-invalid");
    byId("task-due-date").classList.remove("is-invalid");
    byId("task-due-time").classList.remove("is-invalid");
  }

  function openTaskModal(task = null, presetTitle = "", presetDate = "") {
    byId("task-form").reset();
    clearFormErrors();
    byId("task-id").value = task?.id || "";
    byId("task-title").value = task?.title || presetTitle;
    byId("task-description").value = task?.description || "";
    byId("task-due-date").value = task?.dueDate || presetDate || (state.view === "today" ? localDateString(new Date()) : "");
    byId("task-due-time").value = task?.dueTime || "";
    byId("task-importance").value = String(task?.importance || 5);
    byId("importance-value").textContent = byId("task-importance").value;
    byId("task-category").value = task?.category || "";
    byId("task-project").value = task?.project || "";
    byId("task-tags").value = (task?.tags || []).join(", ");
    byId("task-status").value = task?.status || "todo";
    byId("status-field").classList.toggle("d-none", !task);
    byId("task-modal-title").textContent = task ? "Edit task" : "New task";
    taskModal.show();
    window.setTimeout(() => byId("task-title").focus(), 150);
  }

  function taskFromForm() {
    const title = byId("task-title").value.trim();
    const dueDate = byId("task-due-date").value.trim();
    const dueTime = byId("task-due-time").value;
    let valid = true;
    clearFormErrors();
    if (!title) {
      byId("title-error").textContent = "Please enter a task title.";
      byId("task-title").classList.add("is-invalid");
      valid = false;
    }
    if (dueDate && !parseDate(dueDate)) {
      byId("date-error").textContent = "Enter a valid date in MM/DD/YYYY format.";
      byId("task-due-date").classList.add("is-invalid");
      valid = false;
    }
    if (dueTime && !dueDate) {
      byId("time-error").textContent = "Add a due date before setting a time.";
      byId("task-due-time").classList.add("is-invalid");
      valid = false;
    }
    if (!valid) return null;
    const existing = state.tasks.find((task) => task.id === byId("task-id").value);
    return {
      id: existing?.id || (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
      title,
      description: byId("task-description").value.trim(),
      dueDate,
      dueTime,
      importance: Number(byId("task-importance").value),
      category: byId("task-category").value.trim(),
      project: byId("task-project").value.trim(),
      tags: [...new Set(byId("task-tags").value.split(",").map((tag) => tag.trim()).filter(Boolean))],
      status: existing ? byId("task-status").value : "todo",
      isDeleted: false,
      createdAt: existing?.createdAt || new Date().toISOString()
    };
  }

  function addQuickTask(event) {
    event.preventDefault();
    const title = byId("quick-title").value.trim();
    if (!title) {
      byId("quick-error").textContent = "Please enter a task title.";
      byId("quick-title").focus();
      return;
    }
    state.tasks.unshift({
      id: window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title, description: "", dueDate: state.view === "today" ? localDateString(new Date()) : "", importance: 5, category: "", project: "",
      tags: [], status: "todo", isDeleted: false, createdAt: new Date().toISOString()
    });
    const saved = saveTasks();
    byId("quick-title").value = "";
    byId("quick-error").textContent = "";
    if (state.view === "trash") setView("all");
    else render();
    if (saved) showNotice("Task added.");
  }

  function moveToTrash(id) {
    const index = state.tasks.findIndex((task) => task.id === id);
    if (index < 0) return;
    const [task] = state.tasks.splice(index, 1);
    state.trash.unshift({ ...task, isDeleted: true });
    const activeSaved = saveTasks();
    const trashSaved = saveTrash();
    render();
    if (activeSaved && trashSaved) showNotice("Task moved to trash.");
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
      case "new-task": openTaskModal(); break;
      case "edit": if (task) openTaskModal(task); break;
      case "delete": moveToTrash(id); break;
      case "restore": restoreTask(id); break;
      case "purge": {
        const initialLength = state.trash.length;
        state.trash = state.trash.filter((item) => item.id !== id);
        if (state.trash.length !== initialLength) {
          const saved = saveTrash();
          render();
          if (saved) showNotice("Task permanently deleted.");
        }
        break;
      }
      case "toggle":
        if (task) {
          task.status = target.checked ? "done" : "todo";
          const saved = saveTasks();
          render();
          if (saved) showNotice(task.status === "done" ? "Task completed." : "Task marked as to do.");
        }
        break;
      case "status":
        if (task) {
          task.status = target.value;
          const saved = saveTasks();
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
      default: break;
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
      if (key === "category") byId("category-filter").value = "";
      if (key === "tag") byId("tag-filter").value = "";
      render();
      return;
    }
    if (target.dataset.action) {
      if (target.dataset.action === "status" || target.dataset.action === "toggle") return;
      event.preventDefault();
      handleAction(target.dataset.action, target.dataset.id, target);
    }
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target.closest('[data-action="edit"][role="button"]');
    if (target && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      handleAction("edit", target.dataset.id, target);
    }
    if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
      event.preventDefault();
      byId("search-input").focus();
    }
  });

  byId("task-list").addEventListener("change", (event) => {
    if (event.target.matches('[data-action="status"]')) handleAction("status", event.target.dataset.id, event.target);
    if (event.target.matches('[data-action="toggle"]')) handleAction("toggle", event.target.dataset.id, event.target);
  });

  byId("task-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const task = taskFromForm();
    if (!task) return;
    const existingIndex = state.tasks.findIndex((item) => item.id === task.id);
    if (existingIndex >= 0) state.tasks[existingIndex] = task;
    else state.tasks.unshift(task);
    const saved = saveTasks();
    taskModal.hide();
    if (state.view === "trash") setView("all");
    else render();
    if (saved) showNotice(existingIndex >= 0 ? "Task updated." : "Task added.");
  });

  byId("quick-add-form").addEventListener("submit", addQuickTask);
  byId("quick-title").addEventListener("input", () => { byId("quick-error").textContent = ""; });
  byId("task-title").addEventListener("input", () => {
    if (byId("task-title").value.trim()) {
      byId("title-error").textContent = "";
      byId("task-title").classList.remove("is-invalid");
    }
  });
  byId("task-due-date").addEventListener("input", () => {
    byId("date-error").textContent = "";
    byId("task-due-date").classList.remove("is-invalid");
  });
  byId("task-due-time").addEventListener("input", () => {
    byId("time-error").textContent = "";
    byId("task-due-time").classList.remove("is-invalid");
  });
  byId("task-importance").addEventListener("input", (event) => {
    byId("importance-value").textContent = event.target.value;
  });
  ["search-input", "category-filter", "project-filter", "tag-filter", "importance-filter", "status-filter", "sort-select"].forEach((id) => {
    byId(id).addEventListener(id === "search-input" ? "input" : "change", () => {
      renderTaskList(getVisibleTasks());
      renderEmptyState(getVisibleTasks());
      byId("calendar-view").classList.toggle("d-none", state.view !== "calendar");
      byId("task-list").classList.toggle("d-none", state.view === "calendar");
      if (state.view === "calendar") renderCalendar();
    });
  });

  render();
})();
