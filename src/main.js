import '/src/style.css'
import { createClient } from '@supabase/supabase-js';

const CONFIG = {
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  BUILDERBOT_BASE_URL: import.meta.env.VITE_BUILDERBOT_BASE_URL,
  BUILDERBOT_BOT_ID: import.meta.env.VITE_BUILDERBOT_BOT_ID,
  BUILDERBOT_API_KEY: import.meta.env.VITE_BUILDERBOT_API_KEY
};

const supabaseClient = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

// State
let contacts = new Map();
let messages = [];
let activePhone = null;
let currentFilter = 'all';
let searchQuery = '';

// DOM
const contactListEl = document.getElementById('contact-list');
const messagesContainerEl = document.getElementById('messages-container');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const emptyStateEl = document.getElementById('empty-chat-state');
const activeChatEl = document.getElementById('active-chat-container');
const activeNameEl = document.getElementById('active-contact-name');
const activeAvatarEl = document.getElementById('active-avatar');
const btnFavorite = document.getElementById('btn-favorite');
const clientModal = document.getElementById('client-modal');
const clientForm = document.getElementById('client-detail-form');

async function init() {
  console.log("Grow Labs Core Online");
  await loadInitialData();
  setupSubscriptions();
  setupEventListeners();
  renderSidebar();
}

async function loadInitialData() {
  const { data: contactos } = await supabaseClient.from('contactos').select('*');
  if (contactos) {
    contactos.forEach(c => contacts.set(c.telefono, { ...c, lastMsg: null }));
  }

  const { data: lastMsgs } = await supabaseClient
    .from('mensajes')
    .select('*')
    .order('created_at', { ascending: false });

  if (lastMsgs) {
    lastMsgs.forEach(m => {
      const contact = contacts.get(m.cliente_telefono);
      if (contact && !contact.lastMsg) {
        contact.lastMsg = m;
      }
    });
  }
}

function setupSubscriptions() {
  supabaseClient
    .channel('db-changes')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes' }, async (payload) => {
      const newMsg = payload.new;
      if (contacts.has(newMsg.cliente_telefono)) {
        const contact = contacts.get(newMsg.cliente_telefono);
        contact.lastMsg = newMsg;
        contacts.set(newMsg.cliente_telefono, contact);
      } else {
        await refreshContact(newMsg.cliente_telefono);
      }
      if (activePhone === newMsg.cliente_telefono) {
        messages.push(newMsg);
        renderMessage(newMsg);
        scrollToBottom();
      }
      renderSidebar();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'contactos' }, (payload) => {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const updated = payload.new;
        const existing = contacts.get(updated.telefono) || {};
        contacts.set(updated.telefono, { ...existing, ...updated });
        if (activePhone === updated.telefono) updateActiveChatUI(updated);
      } else if (payload.eventType === 'DELETE') {
        contacts.delete(payload.old.telefono);
      }
      renderSidebar();
    })
    .subscribe();
}

async function refreshContact(phone) {
  const { data } = await supabaseClient.from('contactos').select('*').eq('telefono', phone).single();
  if (data) contacts.set(phone, { ...data, lastMsg: null });
}

function setupEventListeners() {
  document.getElementById('contact-search')?.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    renderSidebar();
  });
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.filter;
      renderSidebar();
    });
  });
  chatForm?.addEventListener('submit', handleSendMessage);
  document.getElementById('btn-refresh')?.addEventListener('click', () => location.reload());
  btnFavorite?.addEventListener('click', toggleFavorite);
  document.getElementById('btn-edit-client')?.addEventListener('click', openModal);
  document.getElementById('btn-close-modal')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal')?.addEventListener('click', closeModal);
  clientForm?.addEventListener('submit', handleUpdateClient);
}

function renderSidebar() {
  if (!contactListEl) return;
  contactListEl.innerHTML = '';
  const sorted = Array.from(contacts.values()).sort((a, b) => {
    const timeA = a.lastMsg ? new Date(a.lastMsg.created_at) : new Date(0);
    const timeB = b.lastMsg ? new Date(b.lastMsg.created_at) : new Date(0);
    return timeB - timeA;
  });
  const filtered = sorted.filter(c => {
    const matchesSearch = (c.nombre || '').toLowerCase().includes(searchQuery) || c.telefono.includes(searchQuery);
    const matchesFilter = currentFilter === 'all' || (currentFilter === 'unread' && c.lastMsg && !c.lastMsg.es_mio && c.lastMsg.estado === 'received') || (currentFilter === 'favorite' && c.es_favorito);
    return matchesSearch && matchesFilter;
  });
  if (filtered.length === 0) {
    contactListEl.innerHTML = '<div style="padding: 20px; text-align:center; opacity:0.5;">No hay chats disponibles.</div>';
    return;
  }
  filtered.forEach(contact => {
    const item = document.createElement('div');
    item.className = `contact-item ${activePhone === contact.telefono ? 'active' : ''}`;
    const lastMsgText = contact.lastMsg ? (contact.lastMsg.es_mio ? 'Tú: ' : '') + contact.lastMsg.contenido : 'Sin mensajes';
    const lastMsgTime = contact.lastMsg ? formatTimeShort(contact.lastMsg.created_at) : '';
    const initial = (contact.nombre || contact.telefono).charAt(0).toUpperCase();
    item.innerHTML = `
            <div class="contact-avatar"></div>
            <div class="contact-info">
                <div class="contact-header">
                    <span class="contact-name">${contact.nombre || contact.telefono}</span>
                    <span class="contact-time">${lastMsgTime}</span>
                </div>
                <div class="contact-last-msg">${lastMsgText}</div>
            </div>
            ${contact.es_favorito ? '<i class="fa-solid fa-star" style="color:var(--primary-green); font-size:0.7rem; margin-left:5px;"></i>' : ''}
        `;

    // Aplicar logo como fondo si es necesario o cargar avatar personalizado
    const avatarEl = item.querySelector('.contact-avatar');
    if (avatarEl) {
      avatarEl.style.backgroundImage = `url('/logogrow.png')`;
      avatarEl.style.backgroundSize = 'contain';
      avatarEl.style.backgroundPosition = 'center';
      avatarEl.style.backgroundRepeat = 'no-repeat';
    }

    item.onclick = () => selectContact(contact.telefono);
    contactListEl.appendChild(item);
  });
}

async function selectContact(phone) {
  activePhone = phone;
  const contact = contacts.get(phone);
  if (emptyStateEl) emptyStateEl.style.display = 'none';
  if (activeChatEl) activeChatEl.style.display = 'flex';
  updateActiveChatUI(contact);
  renderSidebar();
  loadMessages(phone);
}

function updateActiveChatUI(contact) {
  if (activeNameEl) activeNameEl.textContent = contact.nombre || contact.telefono;
  if (activeAvatarEl) {
    activeAvatarEl.style.backgroundImage = `url('/logogrow.png')`;
    activeAvatarEl.style.backgroundSize = 'contain';
    activeAvatarEl.style.backgroundPosition = 'center';
    activeAvatarEl.style.backgroundRepeat = 'no-repeat';
    activeAvatarEl.textContent = '';
  }
  if (btnFavorite) {
    btnFavorite.classList.toggle('active', contact.es_favorito);
    btnFavorite.innerHTML = contact.es_favorito ? '<i class="fa-solid fa-star"></i>' : '<i class="fa-regular fa-star"></i>';
  }
}

async function loadMessages(phone) {
  if (!messagesContainerEl) return;
  messagesContainerEl.innerHTML = '<div style="text-align:center; opacity:0.5; padding:20px;">Cargando mensajes premium...</div>';
  const { data } = await supabaseClient.from('mensajes').select('*').eq('cliente_telefono', phone).order('created_at', { ascending: true });
  if (data) {
    messages = data;
    messagesContainerEl.innerHTML = '';
    messages.forEach(renderMessage);
    scrollToBottom();
  }
}

function renderMessage(msg) {
  const div = document.createElement('div');
  div.className = `message ${msg.es_mio ? 'sent' : 'received'}`;
  const time = formatTimeShort(msg.created_at);
  div.innerHTML = `
        <div class="message-content">${escapeHTML(msg.contenido)}</div>
        <div class="message-meta">${time} ${msg.es_mio ? '<i class="fa-solid fa-check-double" style="margin-left:5px; font-size:0.6rem;"></i>' : ''}</div>
    `;
  messagesContainerEl?.appendChild(div);
}

async function handleSendMessage(e) {
  e.preventDefault();
  const content = chatInput?.value.trim();
  if (!content || !activePhone) return;
  chatInput.value = '';
  const { data } = await supabaseClient.from('mensajes').insert({ cliente_telefono: activePhone, contenido: content, es_mio: true, estado: 'sending' }).select().single();
  if (data) {
    try {
      await fetch(`${CONFIG.BUILDERBOT_BASE_URL}/${CONFIG.BUILDERBOT_BOT_ID}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-builderbot': CONFIG.BUILDERBOT_API_KEY },
        body: JSON.stringify({ messages: { content: content }, number: activePhone, checkIfExists: false })
      });
      await supabaseClient.from('mensajes').update({ estado: 'sent' }).eq('id', data.id);
    } catch (err) { console.error(err); }
  }
}

async function toggleFavorite() {
  if (!activePhone) return;
  const contact = contacts.get(activePhone);
  const newState = !contact.es_favorito;
  const { error } = await supabaseClient.from('contactos').update({ es_favorito: newState }).eq('telefono', activePhone);
  if (!error) {
    contact.es_favorito = newState;
    contacts.set(activePhone, contact);
    renderSidebar();
    updateActiveChatUI(contact);
  }
}

function openModal() {
  if (!activePhone) return;
  const contact = contacts.get(activePhone);
  document.getElementById('modal-phone').value = contact.telefono;
  document.getElementById('modal-name').value = contact.nombre || '';
  document.getElementById('modal-email').value = contact.email || '';
  document.getElementById('modal-device').value = contact.dispositivo || '';
  document.getElementById('modal-interest').value = contact.interes || 'Consulta General';
  document.getElementById('modal-notes').value = contact.notas || '';
  if (clientModal) clientModal.style.display = 'flex';
}

function closeModal() { if (clientModal) clientModal.style.display = 'none'; }

async function handleUpdateClient(e) {
  e.preventDefault();
  const phone = document.getElementById('modal-phone').value;
  const updates = {
    nombre: document.getElementById('modal-name').value,
    email: document.getElementById('modal-email').value,
    dispositivo: document.getElementById('modal-device').value,
    interes: document.getElementById('modal-interest').value,
    notas: document.getElementById('modal-notes').value
  };
  const { error } = await supabaseClient.from('contactos').update(updates).eq('telefono', phone);
  if (!error) closeModal();
}

function formatTimeShort(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  return date.toDateString() === now.toDateString() ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
}

function scrollToBottom() { if (messagesContainerEl) messagesContainerEl.scrollTop = messagesContainerEl.scrollHeight; }

function escapeHTML(str) {
  const p = document.createElement('p');
  p.textContent = str;
  return p.innerHTML;
}

init();
