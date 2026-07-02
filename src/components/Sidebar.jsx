import { useState } from 'react';
import LogoMark from './LogoMark.jsx';
import { IconTrash, IconPlus, IconMoon, IconSun, IconGhost, IconEdit } from './Icons.jsx';

export default function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onTemporaryChat,
  onDeleteChat,
  onRenameChat,
  sidebarOpen,
  onCloseSidebar,
  theme,
  onToggleTheme,
  tempMode,
}) {
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState('');

  const confirmDelete = () => {
    if (deleteTarget) {
      onDeleteChat(deleteTarget);
      setDeleteTarget(null);
    }
  };

  const startRename = (conv) => {
    setEditingId(conv.id);
    setDraft(conv.title || '');
  };

  const commitRename = () => {
    if (editingId && draft.trim()) onRenameChat?.(editingId, draft.trim());
    setEditingId(null);
    setDraft('');
  };

  return (
    <>
      {sidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          onClick={onCloseSidebar}
          aria-label="Close sidebar"
        />
      )}

      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <LogoMark size={32} />
            <span>Lumina</span>
          </div>
          <div className="sidebar-actions">
            <button type="button" className="btn sidebar-new" onClick={onNewChat}>
              <IconPlus />
              <span>New chat</span>
            </button>
            <button
              type="button"
              className={`sidebar-temp${tempMode ? ' active' : ''}`}
              onClick={onTemporaryChat}
            >
              <IconGhost />
              <span>Temporary chat</span>
            </button>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Chat history">
          {conversations.length === 0 && (
            <p className="sidebar-empty">No conversations yet</p>
          )}
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`sidebar-item${activeId === conv.id ? ' active' : ''}`}
            >
              {editingId === conv.id ? (
                <input
                  className="sidebar-item-edit"
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') { setEditingId(null); setDraft(''); }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="sidebar-item-btn"
                  onClick={() => onSelect(conv.id)}
                  onDoubleClick={() => startRename(conv)}
                >
                  <span className="sidebar-item-title">{conv.title || 'Untitled'}</span>
                  {conv.sourceType && (
                    <span className="sidebar-item-meta">{conv.sourceType}</span>
                  )}
                </button>
              )}
              {editingId !== conv.id && (
                <div className="sidebar-item-tools">
                  <button
                    type="button"
                    className="sidebar-item-tool"
                    onClick={(e) => { e.stopPropagation(); startRename(conv); }}
                    aria-label={`Rename ${conv.title || 'Untitled'}`}
                    title="Rename"
                  >
                    <IconEdit />
                  </button>
                  <button
                    type="button"
                    className="sidebar-item-tool sidebar-item-delete"
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(conv.id); }}
                    aria-label={`Delete ${conv.title || 'Untitled'}`}
                    title="Delete"
                  >
                    <IconTrash />
                  </button>
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-theme-toggle"
            onClick={onToggleTheme}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
            <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
          </button>
        </div>
      </aside>

      {deleteTarget && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal modal--delete" role="dialog" aria-label="Delete conversation">
            <div className="modal-delete-icon">
              <IconTrash />
            </div>
            <h3>Delete conversation?</h3>
            <p>This will permanently remove this chat and all its messages. This action cannot be undone.</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
