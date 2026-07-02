const STORAGE_KEY = 'lumina-chat-data';

const conversationListeners = new Set();
const messageListeners = new Map();

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { conversations: [], messages: {} };
    return JSON.parse(raw);
  } catch {
    return { conversations: [], messages: {} };
  }
}

function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    const quota =
      e?.name === 'QuotaExceededError' ||
      e?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e?.code === 22;
    if (quota) {
      throw new Error(
        'Browser storage is full. Delete an older conversation or remove a large source, then try again.'
      );
    }
    throw e;
  }
}

function notifyConversations() {
  const data = loadData();
  const list = [...data.conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);
  conversationListeners.forEach((cb) => cb(list));
}

function notifyMessages(convId) {
  const data = loadData();
  const list = [...(data.messages[convId] || [])].sort((a, b) => a.createdAt - b.createdAt);
  const listeners = messageListeners.get(convId);
  if (listeners) listeners.forEach((cb) => cb(list));
}

function newId() {
  return crypto.randomUUID();
}

export function subscribeConversations(_uid, onData, onError) {
  try {
    conversationListeners.add(onData);
    notifyConversations();
    return () => conversationListeners.delete(onData);
  } catch (e) {
    onError?.(e);
    return () => {};
  }
}

export function subscribeMessages(_uid, convId, onData, onError) {
  try {
    if (!messageListeners.has(convId)) messageListeners.set(convId, new Set());
    messageListeners.get(convId).add(onData);
    notifyMessages(convId);
    return () => {
      const set = messageListeners.get(convId);
      if (set) {
        set.delete(onData);
        if (set.size === 0) messageListeners.delete(convId);
      }
    };
  } catch (e) {
    onError?.(e);
    return () => {};
  }
}

export async function createConversation(_uid, { title, sourceType, sourceTitle, sourceText, sources }) {
  const data = loadData();
  const now = Date.now();
  const id = newId();
  data.conversations.push({
    id,
    title: title || 'New chat',
    sourceType: sourceType || null,
    sourceTitle: sourceTitle || null,
    sourceText: sourceText || null,
    sources: sources || null,
    createdAt: now,
    updatedAt: now,
  });
  data.messages[id] = [];
  saveData(data);
  notifyConversations();
  return id;
}

export async function updateConversation(_uid, convId, patch) {
  const data = loadData();
  const conv = data.conversations.find((c) => c.id === convId);
  if (!conv) return;
  Object.assign(conv, patch, { updatedAt: Date.now() });
  saveData(data);
  notifyConversations();
}

export async function addMessage(_uid, convId, message) {
  const data = loadData();
  if (!data.messages[convId]) data.messages[convId] = [];
  data.messages[convId].push({
    id: newId(),
    ...message,
    createdAt: Date.now(),
  });

  const conv = data.conversations.find((c) => c.id === convId);
  if (conv) {
    if (message.conversationTitle) conv.title = message.conversationTitle;
    conv.updatedAt = Date.now();
  }

  saveData(data);
  notifyConversations();
  notifyMessages(convId);
}

export async function updateMessage(_uid, convId, messageId, patch) {
  const data = loadData();
  const list = data.messages[convId];
  if (!list) return;
  const msg = list.find((m) => m.id === messageId);
  if (!msg) return;
  Object.assign(msg, patch);
  saveData(data);
  notifyMessages(convId);
}

export async function deleteConversation(_uid, convId) {
  const data = loadData();
  data.conversations = data.conversations.filter((c) => c.id !== convId);
  delete data.messages[convId];
  saveData(data);
  const listeners = messageListeners.get(convId);
  if (listeners) {
    listeners.forEach((cb) => cb([]));
    messageListeners.delete(convId);
  }
  notifyConversations();
}
