const STORAGE_KEY = "taskly_tarefas_v2";
const THEME_KEY = "taskly_tema_v1";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const supabaseClient = window.supabase?.createClient(
  window.TASKLY_SUPABASE_URL,
  window.TASKLY_SUPABASE_PUBLISHABLE_KEY
);
let authUser = null;
let cloudSyncReady = false;

const todayISO = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const PROFILE_KEY = "taskly_perfis_v1";

function loadWorkspace() {
  try {
    const savedProfiles = JSON.parse(localStorage.getItem(PROFILE_KEY));
    if (Array.isArray(savedProfiles) && savedProfiles.length) {
      const activeId = localStorage.getItem("taskly_perfil_ativo") || savedProfiles[0].id;
      return {
        profiles: savedProfiles,
        activeId: savedProfiles.some(profile => profile.id === activeId) ? activeId : savedProfiles[0].id
      };
    }
  } catch {}

  // Aproveita as tarefas que já existiam antes da criação dos perfis.
  let oldTasks = [];
  try {
    const savedTasks = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(savedTasks)) oldTasks = savedTasks;
  } catch {}

  const firstProfile = {
    id: makeId(),
    name: "Meu perfil",
    email: "",
    bio: "",
    tasks: oldTasks
  };
  return { profiles: [firstProfile], activeId: firstProfile.id };
}

const workspace = loadWorkspace();
let profiles = workspace.profiles;
let activeProfileId = workspace.activeId;
let tasks = getActiveProfile().tasks || [];
let currentFilter = "all";
let currentCategory = null;
let editorSubtasks = [];
let toastTimer;
let creatingNewProfile = false;

function getActiveProfile() {
  return profiles.find(profile => profile.id === activeProfileId) || profiles[0];
}

function saveProfiles() {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profiles));
  localStorage.setItem("taskly_perfil_ativo", activeProfileId);
  if (authUser && cloudSyncReady) {
    const rows = profiles.map(profile => ({
      id: profile.id,
      owner_id: authUser.id,
      name: profile.name || "Meu perfil",
      email: profile.email || "",
      bio: profile.bio || ""
    }));
    supabaseClient.from("profiles").upsert(rows, { onConflict: "id" }).then(({ error }) => {
      if (error) {
        console.error("Falha ao salvar perfis na nuvem:", error);
        showToast("Não foi possível sincronizar os dados do perfil.");
      }
    });
  }
}

function saveTasks() {
  const profile = getActiveProfile();
  profile.tasks = tasks;
  saveProfiles();
}

function makeId() {
  return window.crypto?.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function formatDate(value) {
  if (!value) return "Sem prazo";
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "short"
  });
}

function isOverdue(task) {
  return Boolean(task.date && task.date < todayISO() && !task.completed);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function setDateAndGreeting() {
  const now = new Date();
  $("#currentDate").textContent = now.toLocaleDateString("pt-BR", {
    weekday: "short", day: "2-digit", month: "short", year: "numeric"
  });

  const hour = now.getHours();
  $("#greeting").textContent = hour < 12
    ? "BOM DIA! VAMOS COMEÇAR?"
    : hour < 18
      ? "BOA TARDE! SIGA NO SEU RITMO"
      : "BOA NOITE! UM PASSO DE CADA VEZ";
}

function updateStats() {
  const total = tasks.length;
  const completed = tasks.filter(task => task.completed).length;
  const pending = total - completed;
  const today = tasks.filter(task => task.date === todayISO() && !task.completed).length;
  const progress = total ? Math.round(completed / total * 100) : 0;

  $("#totalStat").textContent = total;
  $("#pendingStat").textContent = pending;
  $("#completedStat").textContent = completed;
  $("#progressStat").textContent = progress;
  $("#progressBar").style.width = `${progress}%`;
  $("#allCount").textContent = total;
  $("#todayCount").textContent = today;
  $("#tabAll").textContent = total;
  $("#tabPending").textContent = pending;
  $("#tabCompleted").textContent = completed;
}

function getVisibleTasks() {
  const search = $("#searchInput").value.trim().toLocaleLowerCase("pt-BR");

  const visible = tasks.filter(task => {
    if (currentFilter === "today" && (task.date !== todayISO() || task.completed)) return false;
    if (currentFilter === "upcoming" && (!task.date || task.date < todayISO() || task.completed)) return false;
    if (currentFilter === "pending" && task.completed) return false;
    if (currentFilter === "completed" && !task.completed) return false;
    if (currentCategory && task.category !== currentCategory) return false;

    const searchable = [
      task.title, task.description, task.category,
      ...(task.subtasks || []).map(item => item.text)
    ].join(" ").toLocaleLowerCase("pt-BR");

    return searchable.includes(search);
  });

  const sort = $("#sortSelect").value;
  const priorityOrder = { high: 0, medium: 1, low: 2 };

  visible.sort((a, b) => {
    if (sort === "priority") {
      return (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1)
        || (a.date || "9999").localeCompare(b.date || "9999");
    }
    if (sort === "newest") return (b.createdAt || 0) - (a.createdAt || 0);
    if (sort === "alphabetical") return a.title.localeCompare(b.title, "pt-BR");
    return (a.date || "9999").localeCompare(b.date || "9999")
      || (b.createdAt || 0) - (a.createdAt || 0);
  });

  return visible;
}

function renderTasks() {
  const visible = getVisibleTasks();
  const list = $("#taskList");

  list.innerHTML = visible.map(task => {
    const subtasks = task.subtasks || [];
    const finishedSteps = subtasks.filter(item => item.done).length;
    const priorityName = { high: "Alta", medium: "Média", low: "Baixa" }[task.priority] || "Média";

    return `
      <article class="task-row ${task.completed ? "is-completed" : ""}" data-id="${escapeHTML(task.id)}">
        <button class="task-check ${task.completed ? "checked" : ""}" data-action="toggle" aria-label="${task.completed ? "Reabrir" : "Concluir"} tarefa">${task.completed ? "✓" : ""}</button>
        <div class="task-main">
          <p class="task-title">${escapeHTML(task.title)}</p>
          ${task.description ? `<p class="task-description">${escapeHTML(task.description)}</p>` : ""}
          ${subtasks.length ? `
            <div class="subtask-progress">
              <span>${finishedSteps}/${subtasks.length} etapas</span>
              <span class="subtask-progress-track"><span style="width:${finishedSteps / subtasks.length * 100}%"></span></span>
            </div>` : ""}
        </div>
        <div class="task-meta">
          <span class="category-pill" data-category="${escapeHTML(task.category)}">${escapeHTML(task.category)}</span>
          <span class="priority-pill ${escapeHTML(task.priority)}">${priorityName}</span>
          <span class="task-date ${isOverdue(task) ? "overdue" : ""}">${isOverdue(task) ? "Atrasada · " : ""}${formatDate(task.date)}${task.time ? ` · ${escapeHTML(task.time)}` : ""}</span>
        </div>
        <div class="task-actions">
          <button class="task-action" data-action="edit" title="Editar tarefa" aria-label="Editar tarefa">✎</button>
          <button class="task-action" data-action="duplicate" title="Duplicar tarefa" aria-label="Duplicar tarefa">▣</button>
          <button class="task-action delete" data-action="delete" title="Excluir tarefa" aria-label="Excluir tarefa">×</button>
        </div>
      </article>`;
  }).join("");

  $("#emptyState").hidden = visible.length > 0;
  list.hidden = visible.length === 0;
  $("#taskCountLabel").textContent = `${visible.length} ${visible.length === 1 ? "tarefa encontrada" : "tarefas encontradas"}`;
  updateStats();
}

function setFilter(filter, category = null) {
  currentFilter = filter;
  currentCategory = category;

  $$(".nav-link").forEach(button => {
    button.classList.toggle("active", button.dataset.filter === filter && !category);
  });
  $$(".filter-tab").forEach(button => {
    button.classList.toggle("active", button.dataset.filter === filter && !category);
  });
  $$(".category-link").forEach(button => {
    button.classList.toggle("active", button.dataset.category === category);
  });

  const titles = {
    all: "Visão geral", today: "Hoje", upcoming: "Próximas",
    pending: "Pendentes", completed: "Concluídas"
  };
  const headings = {
    all: "Sua visão geral", today: "O que fazer hoje",
    upcoming: "O que vem pela frente", pending: "Tarefas pendentes",
    completed: "Suas conquistas"
  };

  $("#breadcrumbTitle").textContent = category || titles[filter];
  $("#sectionHeading").textContent = category || headings[filter];
  $("#sectionSubheading").textContent = category
    ? `Tarefas da categoria ${category}.`
    : "Tudo o que você precisa organizar, em um só lugar.";

  renderTasks();
}

function renderSubtaskEditor() {
  $("#subtaskEditorList").innerHTML = editorSubtasks.map((item, index) => `
    <div class="subtask-editor-item">
      <span>${escapeHTML(item.text)}</span>
      <button type="button" data-remove-subtask="${index}" aria-label="Remover etapa">×</button>
    </div>
  `).join("");

  const count = editorSubtasks.length;
  $("#subtaskCount").textContent = `${count} ${count === 1 ? "etapa" : "etapas"}`;
}

function addSubtask() {
  const input = $("#subtaskInput");
  const text = input.value.trim();

  if (!text) {
    input.focus();
    return;
  }

  editorSubtasks.push({ id: makeId(), text, done: false });
  input.value = "";
  renderSubtaskEditor();
  input.focus();
}

function openModal(task = null) {
  $("#taskForm").reset();
  $("#taskId").value = task?.id || "";
  editorSubtasks = task ? (task.subtasks || []).map(item => ({ ...item })) : [];

  $("#modalTitle").textContent = task ? "Editar tarefa" : "Criar nova tarefa";
  $("#saveTaskButton").innerHTML = task
    ? 'Salvar alterações <span>→</span>'
    : 'Salvar tarefa <span>→</span>';

  if (task) {
    $("#taskTitle").value = task.title || "";
    $("#taskDescription").value = task.description || "";
    $("#taskCategory").value = task.category || "Outros";
    $("#taskPriority").value = task.priority || "medium";
    $("#taskDate").value = task.date || "";
    $("#taskTime").value = task.time || "";
  }

  updateDescriptionCounter();
  renderSubtaskEditor();
  $("#taskModal").classList.add("open");
  $("#taskModal").setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => $("#taskTitle").focus(), 80);
}

function closeModal() {
  $("#taskModal").classList.remove("open");
  $("#taskModal").setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function updateDescriptionCounter() {
  $("#descriptionCounter").textContent = $("#taskDescription").value.length;
}

function saveTask(event) {
  event.preventDefault();

  const id = $("#taskId").value;
  const title = $("#taskTitle").value.trim();

  if (!title) {
    $("#taskTitle").focus();
    showToast("Digite um nome para a tarefa.");
    return;
  }

  const data = {
    title,
    description: $("#taskDescription").value.trim(),
    category: $("#taskCategory").value,
    priority: $("#taskPriority").value,
    date: $("#taskDate").value,
    time: $("#taskTime").value,
    subtasks: editorSubtasks
  };

  if (id) {
    const index = tasks.findIndex(task => task.id === id);
    if (index !== -1) tasks[index] = { ...tasks[index], ...data, updatedAt: Date.now() };
    showToast("Tarefa atualizada!");
  } else {
    tasks.unshift({
      id: makeId(), ...data, completed: false,
      createdAt: Date.now()
    });
    showToast("Tarefa criada com sucesso!");
  }

  saveTasks();
  closeModal();
  renderTasks();
}

function handleTaskAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const row = button.closest(".task-row");
  const task = tasks.find(item => item.id === row?.dataset.id);
  if (!task) return;

  if (button.dataset.action === "toggle") {
    task.completed = !task.completed;
    task.completedAt = task.completed ? Date.now() : null;
    showToast(task.completed ? "Tarefa concluída. Muito bem!" : "Tarefa reaberta.");
  }

  if (button.dataset.action === "edit") {
    openModal(task);
    return;
  }

  if (button.dataset.action === "duplicate") {
    tasks.unshift({
      ...task,
      id: makeId(),
      title: `${task.title} (cópia)`,
      completed: false,
      completedAt: null,
      subtasks: (task.subtasks || []).map(item => ({ ...item, id: makeId(), done: false })),
      createdAt: Date.now()
    });
    showToast("Tarefa duplicada!");
  }

  if (button.dataset.action === "delete") {
    if (!confirm(`Deseja excluir "${task.title}"?`)) return;
    tasks = tasks.filter(item => item.id !== task.id);
    showToast("Tarefa excluída.");
  }

  saveTasks();
  renderTasks();
}

function exportTasks() {
  const backup = {
    app: "Taskly",
    version: 2,
    exportedAt: new Date().toISOString(),
    tasks
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `taskly-backup-${todayISO()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Arquivo exportado!");
}

function importTasks(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const imported = Array.isArray(data) ? data : data.tasks;

      if (!Array.isArray(imported)) throw new Error("Arquivo inválido");

      const cleanTasks = imported
        .filter(item => item && typeof item.title === "string" && item.title.trim())
        .map(item => ({
          id: item.id || makeId(),
          title: item.title,
          description: item.description || "",
          category: ["Estudos", "Pessoal", "Trabalho", "Outros"].includes(item.category) ? item.category : "Outros",
          priority: ["low", "medium", "high"].includes(item.priority) ? item.priority : "medium",
          date: item.date || "",
          time: item.time || "",
          completed: Boolean(item.completed),
          subtasks: Array.isArray(item.subtasks) ? item.subtasks : [],
          createdAt: item.createdAt || Date.now()
        }));

      if (!cleanTasks.length) {
        showToast("Nenhuma tarefa válida foi encontrada.");
        return;
      }

      if (!confirm(`Importar ${cleanTasks.length} tarefa(s)? Isso substituirá sua lista atual.`)) return;

      tasks = cleanTasks;
      saveTasks();
      setFilter("all");
      showToast("Tarefas importadas!");
    } catch {
      showToast("Não foi possível ler esse arquivo.");
    }
  };
  reader.readAsText(file);
}

function clearCompleted() {
  const count = tasks.filter(task => task.completed).length;
  if (!count) {
    showToast("Você ainda não tem tarefas concluídas.");
    return;
  }

  if (!confirm(`Excluir permanentemente ${count} tarefa(s) concluída(s)?`)) return;

  tasks = tasks.filter(task => !task.completed);
  saveTasks();
  renderTasks();
  showToast("Tarefas concluídas removidas.");
}

function initials(name) {
  const parts = String(name || "T").trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0]?.slice(0, 2) || "T").toUpperCase();
}

function updateProfileDisplay() {
  const profile = getActiveProfile();
  const name = profile.name || "Meu perfil";
  const avatar = initials(name);

  $("#sidebarProfileName").textContent = name;
  $("#breadcrumbProfileName").textContent = name;
  $("#sidebarProfileEmail").textContent = profile.email || "Área pessoal";
  $("#sidebarAvatar").textContent = avatar;
  $("#topProfileButton").textContent = avatar;
  $("#profilePreviewAvatar").textContent = avatar;
  $("#profilePreviewName").textContent = name;
}

function renderProfileList() {
  $("#profileList").innerHTML = profiles.map(profile => `
    <div class="profile-list-item ${profile.id === activeProfileId ? "active" : ""}">
      <div class="profile-avatar">${escapeHTML(initials(profile.name))}</div>
      <span class="profile-list-name">${escapeHTML(profile.name)}</span>
      <button type="button" data-switch-profile="${escapeHTML(profile.id)}">
        ${profile.id === activeProfileId ? "Ativo" : "Entrar"}
      </button>
    </div>
  `).join("");
}

function openProfileModal() {
  creatingNewProfile = false;
  const profile = getActiveProfile();
  $("#profileModalTitle").textContent = "Seu perfil";
  $("#profileName").value = profile.name || "";
  $("#profileEmail").value = profile.email || "";
  $("#profileBio").value = profile.bio || "";
  $("#profileName").disabled = false;
  $("#profileEmail").disabled = false;
  $("#profileBio").disabled = false;
  updateProfilePreview();
  renderProfileList();
  $("#profileModal").classList.add("open");
  $("#profileModal").setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeProfileModal() {
  $("#profileModal").classList.remove("open");
  $("#profileModal").setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function updateProfilePreview() {
  const name = $("#profileName").value.trim() || "Seu nome";
  $("#profilePreviewAvatar").textContent = initials(name);
  $("#profilePreviewName").textContent = name;
}

function startNewProfile() {
  creatingNewProfile = true;
  $("#profileModalTitle").textContent = "Criar perfil";
  $("#profileName").value = "";
  $("#profileEmail").value = "";
  $("#profileBio").value = "";
  updateProfilePreview();
  $("#profileName").focus();
}

function saveProfile(event) {
  event.preventDefault();
  const name = $("#profileName").value.trim();
  if (!name) {
    $("#profileName").focus();
    return;
  }

  if (creatingNewProfile) {
    const profile = {
      id: makeId(),
      name,
      email: $("#profileEmail").value.trim(),
      bio: $("#profileBio").value.trim(),
      tasks: []
    };
    profiles.push(profile);
    activeProfileId = profile.id;
    tasks = profile.tasks;
    currentFilter = "all";
    currentCategory = null;
    $("#searchInput").value = "";
    $("#sortSelect").value = "date";
    showToast("Seu novo perfil foi criado!");
  } else {
    const profile = getActiveProfile();
    profile.name = name;
    profile.email = $("#profileEmail").value.trim();
    profile.bio = $("#profileBio").value.trim();
    showToast("Perfil atualizado!");
  }

  saveProfiles();
  updateProfileDisplay();
  renderProfileList();
  setFilter("all");
  closeProfileModal();
}

function switchProfile(profileId) {
  if (profileId === activeProfileId) return;
  const nextProfile = profiles.find(profile => profile.id === profileId);
  if (!nextProfile) return;

  activeProfileId = profileId;
  tasks = nextProfile.tasks || [];
  currentFilter = "all";
  currentCategory = null;
  $("#searchInput").value = "";
  $("#sortSelect").value = "date";
  saveProfiles();
  updateProfileDisplay();
  setFilter("all");
  renderProfileList();
  showToast(`Você entrou no perfil ${nextProfile.name}.`);
}


function setAuthInterface(user) {
  const status = $("#authStatus");
  const signOut = $("#signOutButton");
  const signIn = $("#signInButton");
  const signUp = $("#signUpButton");
  if (user) {
    status.textContent = user.email || "Conta conectada";
    signOut.hidden = false;
    signIn.hidden = true;
    signUp.hidden = true;
    $("#authEmail").value = user.email || "";
    $("#authEmail").disabled = true;
    $("#authPassword").hidden = true;
    $("#authPassword").required = false;
  } else {
    status.textContent = "Não conectado";
    signOut.hidden = true;
    signIn.hidden = false;
    signUp.hidden = false;
    $("#authEmail").disabled = false;
    $("#authPassword").hidden = false;
    $("#authPassword").required = true;
  }
}

function toCloudTask(task, profileId) {
  return {
    id: task.id,
    profile_id: profileId,
    title: task.title,
    description: task.description || "",
    category: task.category || "Outros",
    priority: task.priority || "medium",
    due_date: task.date || null,
    due_time: task.time || null,
    completed: Boolean(task.completed),
    subtasks: Array.isArray(task.subtasks) ? task.subtasks : [],
    created_at: new Date(task.createdAt || Date.now()).toISOString(),
    updated_at: new Date(task.updatedAt || Date.now()).toISOString(),
    completed_at: task.completedAt ? new Date(task.completedAt).toISOString() : null
  };
}

function fromCloudTask(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    category: row.category || "Outros",
    priority: row.priority || "medium",
    date: row.due_date || "",
    time: row.due_time || "",
    completed: Boolean(row.completed),
    subtasks: Array.isArray(row.subtasks) ? row.subtasks : [],
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
    completedAt: row.completed_at ? new Date(row.completed_at).getTime() : null
  };
}

async function syncTasksToCloud(profile) {
  if (!profile?.id || !authUser) return;
  const rows = (profile.tasks || []).map(task => toCloudTask(task, profile.id));
  if (rows.length) {
    const { error } = await supabaseClient.from("tasks").upsert(rows, { onConflict: "id" });
    if (error) throw error;
  }
  const { data: existing, error: readError } = await supabaseClient
    .from("tasks").select("id").eq("profile_id", profile.id);
  if (readError) throw readError;
  const keep = new Set(rows.map(row => row.id));
  const stale = (existing || []).map(row => row.id).filter(id => !keep.has(id));
  if (stale.length) {
    const { error } = await supabaseClient.from("tasks").delete().in("id", stale);
    if (error) throw error;
  }
}

async function migrateLocalWorkspaceToCloud() {
  const localProfiles = profiles.map(profile => ({ ...profile, tasks: [...(profile.tasks || [])] }));
  const migrated = [];
  for (const local of localProfiles) {
    const { data: profileRow, error } = await supabaseClient.from("profiles")
      .insert({ owner_id: authUser.id, name: local.name || "Meu perfil", email: local.email || "", bio: local.bio || "" })
      .select().single();
    if (error) throw error;
    const cloudProfile = { id: profileRow.id, name: profileRow.name, email: profileRow.email || "", bio: profileRow.bio || "", tasks: [] };
    const taskRows = (local.tasks || []).map(task => toCloudTask(task, profileRow.id));
    if (taskRows.length) {
      const { error: taskError } = await supabaseClient.from("tasks").insert(taskRows);
      if (taskError) throw taskError;
    }
    cloudProfile.tasks = local.tasks || [];
    migrated.push({ oldId: local.id, profile: cloudProfile });
  }
  const active = migrated.find(item => item.oldId === activeProfileId) || migrated[0];
  profiles = migrated.map(item => item.profile);
  activeProfileId = active?.profile.id || profiles[0].id;
  tasks = getActiveProfile()?.tasks || [];
  saveProfiles();
}

async function loadCloudWorkspace() {
  const { data: cloudProfiles, error } = await supabaseClient.from("profiles")
    .select("id,name,email,bio").eq("owner_id", authUser.id).order("created_at", { ascending: true });
  if (error) throw error;
  if (!cloudProfiles?.length) {
    await migrateLocalWorkspaceToCloud();
    return;
  }
  const ids = cloudProfiles.map(profile => profile.id);
  const { data: cloudTasks, error: taskError } = await supabaseClient.from("tasks")
    .select("*").in("profile_id", ids).order("created_at", { ascending: false });
  if (taskError) throw taskError;
  profiles = cloudProfiles.map(profile => ({
    id: profile.id, name: profile.name, email: profile.email || "", bio: profile.bio || "",
    tasks: (cloudTasks || []).filter(task => task.profile_id === profile.id).map(fromCloudTask)
  }));
  const savedActive = localStorage.getItem("taskly_perfil_ativo");
  activeProfileId = profiles.some(profile => profile.id === savedActive) ? savedActive : profiles[0].id;
  tasks = getActiveProfile().tasks || [];
  saveProfiles();
}

function showPasswordRecovery() {
  $("#resetPasswordForm").hidden = false;
  $("#authForm").hidden = true;
  $("#forgotPasswordButton").hidden = true;
  openProfileModal();
  $("#resetPasswordForm").hidden = false;
  $("#newPassword").focus();
}

async function initializeCloudAuth() {
  if (!supabaseClient) {
    showToast("Configuração do Supabase não encontrada.");
    return;
  }

  // Registra o evento antes de ler a sessão para não perder o retorno do link de recuperação.
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" && session?.user) {
      authUser = session.user;
      showPasswordRecovery();
      showToast("Link confirmado! Escolha sua nova senha.");
      return;
    }
    if (!session?.user) {
      authUser = null;
      cloudSyncReady = false;
      setAuthInterface(null);
    }
  });

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) console.error(error);
  if (data?.session?.user) {
    authUser = data.session.user;
    try {
      await loadCloudWorkspace();
      cloudSyncReady = true;
      updateProfileDisplay();
      renderProfileList();
      setFilter("all");
      showToast("Conta conectada e tarefas sincronizadas!");
    } catch (syncError) {
      console.error(syncError);
      showToast("Não foi possível carregar a nuvem. Verifique as políticas do Supabase.");
    }
  }
  setAuthInterface(authUser);

  // Fallback para links de recuperação que já chegaram à página antes do listener.
  if (window.location.hash.includes("type=recovery")) {
    showPasswordRecovery();
  }
}

async function requestPasswordReset() {
  if (!supabaseClient) return showToast("Configuração do Supabase não encontrada.");
  const email = $("#authEmail").value.trim();
  if (!email) return showToast("Digite seu e-mail no campo acima para receber o link.");
  const redirectUrl = new URL(window.location.href);
  redirectUrl.search = "";
  redirectUrl.hash = "";
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: redirectUrl.toString()
  });
  if (error) {
    console.error("Falha ao solicitar recuperação:", {
      message: error.message,
      status: error.status,
      code: error.code
    });
    return showToast(`Erro do Supabase: ${error.message} (código: ${error.code || error.status || "não informado"})`);
  }
  showToast("E-mail de recuperação enviado! Confira sua caixa de entrada.");
}

async function updateRecoveredPassword(event) {
  event.preventDefault();
  if (!supabaseClient) return showToast("Configuração do Supabase não encontrada.");
  const password = $("#newPassword").value;
  const confirmation = $("#confirmNewPassword").value;
  if (password.length < 6) return showToast("A senha precisa ter pelo menos 6 caracteres.");
  if (password !== confirmation) return showToast("As senhas não são iguais.");
  const { error } = await supabaseClient.auth.updateUser({ password });
  if (error) {
    console.error("Falha ao atualizar senha:", error);
    return showToast("Não foi possível alterar a senha. Solicite um novo link de recuperação.");
  }
  $("#resetPasswordForm").hidden = true;
  $("#authForm").hidden = false;
  $("#forgotPasswordButton").hidden = false;
  $("#newPassword").value = "";
  $("#confirmNewPassword").value = "";
  setAuthInterface(authUser);
  showToast("Senha alterada com sucesso! Você já pode entrar com ela.");
}

async function signInToCloud(event) {
  event.preventDefault();
  if (!supabaseClient) return showToast("Configuração do Supabase não encontrada.");
  const email = $("#authEmail").value.trim();
  const password = $("#authPassword").value;
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) return showToast(error.message);
  authUser = data.user;
  try {
    await loadCloudWorkspace();
    cloudSyncReady = true;
    setAuthInterface(authUser);
    updateProfileDisplay();
    renderProfileList();
    setFilter("all");
    closeProfileModal();
    showToast("Login realizado e tarefas sincronizadas!");
  } catch (syncError) {
    console.error(syncError);
    showToast("Login feito, mas houve erro ao sincronizar. Confira as tabelas e políticas.");
  }
}

async function signUpToCloud() {
  if (!supabaseClient) return showToast("Configuração do Supabase não encontrada.");
  const email = $("#authEmail").value.trim();
  const password = $("#authPassword").value;
  if (!email || password.length < 6) return showToast("Informe um e-mail e uma senha com pelo menos 6 caracteres.");
  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  if (error) return showToast(error.message);
  if (!data.session) {
    showToast("Conta criada! Confirme seu e-mail e depois entre no Taskly.");
    return;
  }
  authUser = data.user;
  try {
    await loadCloudWorkspace();
    cloudSyncReady = true;
    setAuthInterface(authUser);
    updateProfileDisplay();
    renderProfileList();
    setFilter("all");
    closeProfileModal();
    showToast("Conta criada e tarefas sincronizadas!");
  } catch (syncError) {
    console.error(syncError);
    showToast("Conta criada, mas houve erro ao sincronizar os dados.");
  }
}

async function signOutFromCloud() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) return showToast(error.message);
  authUser = null;
  cloudSyncReady = false;
  setAuthInterface(null);
  showToast("Você saiu da conta. Os dados locais foram mantidos.");
}

// Eventos do formulário e da janela
$("#taskForm").addEventListener("submit", saveTask);
$("#authForm").addEventListener("submit", signInToCloud);
$("#signUpButton").addEventListener("click", signUpToCloud);
$("#forgotPasswordButton").addEventListener("click", requestPasswordReset);
$("#resetPasswordForm").addEventListener("submit", updateRecoveredPassword);
$("#signOutButton").addEventListener("click", signOutFromCloud);
$("#taskDescription").addEventListener("input", updateDescriptionCounter);
$("#addSubtaskButton").addEventListener("click", addSubtask);
$("#subtaskInput").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    addSubtask();
  }
});
$("#subtaskEditorList").addEventListener("click", event => {
  const button = event.target.closest("[data-remove-subtask]");
  if (!button) return;
  editorSubtasks.splice(Number(button.dataset.removeSubtask), 1);
  renderSubtaskEditor();
});

["#addTaskButton", "#heroAddButton", "#emptyAddButton"].forEach(selector => {
  $(selector).addEventListener("click", () => openModal());
});
["#closeModal", "#cancelModal"].forEach(selector => {
  $(selector).addEventListener("click", closeModal);
});
$("#taskModal").addEventListener("click", event => {
  if (event.target === $("#taskModal")) closeModal();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && $("#taskModal").classList.contains("open")) closeModal();
});
$("#taskList").addEventListener("click", handleTaskAction);

// Pesquisa, ordenação e filtros
$("#searchInput").addEventListener("input", renderTasks);
$("#sortSelect").addEventListener("change", renderTasks);
$$(".nav-link, .filter-tab").forEach(button => {
  button.addEventListener("click", () => {
    setFilter(button.dataset.filter);
    $("#sidebar").classList.remove("open");
  });
});
$$(".category-link").forEach(button => {
  button.addEventListener("click", () => {
    setFilter("all", button.dataset.category);
    $("#sidebar").classList.remove("open");
  });
});

// Ações da lista
$("#clearCompleted").addEventListener("click", clearCompleted);
$("#exportButton").addEventListener("click", exportTasks);
$("#importButton").addEventListener("click", () => $("#importFile").click());
$("#importFile").addEventListener("change", event => {
  importTasks(event.target.files[0]);
  event.target.value = "";
});

// Tema e navegação para celular
$("#themeToggle").addEventListener("click", () => {
  document.body.classList.toggle("dark");
  const dark = document.body.classList.contains("dark");
  localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  $("#themeToggle").textContent = dark ? "☼" : "☾";
});
$("#mobileMenu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
document.addEventListener("click", event => {
  if (window.innerWidth <= 850 &&
      !event.target.closest("#sidebar") &&
      !event.target.closest("#mobileMenu")) {
    $("#sidebar").classList.remove("open");
  }
});

// Perfil pessoal e troca entre perfis
$("#openProfileButton").addEventListener("click", openProfileModal);
$("#topProfileButton").addEventListener("click", openProfileModal);
$("#closeProfileModal").addEventListener("click", closeProfileModal);
$("#profileModal").addEventListener("click", event => {
  if (event.target === $("#profileModal")) closeProfileModal();
});
$("#profileForm").addEventListener("submit", saveProfile);
$("#profileName").addEventListener("input", updateProfilePreview);
$("#createProfileButton").addEventListener("click", startNewProfile);
$("#profileList").addEventListener("click", event => {
  const button = event.target.closest("[data-switch-profile]");
  if (button) switchProfile(button.dataset.switchProfile);
});

// Recuperar tema e iniciar
if (localStorage.getItem(THEME_KEY) === "dark") {
  document.body.classList.add("dark");
  $("#themeToggle").textContent = "☼";
}

saveProfiles();
updateProfileDisplay();
setDateAndGreeting();
renderTasks();
initializeCloudAuth();
