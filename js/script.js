(function(){
    try{
      const saved = localStorage.getItem('duckly-theme');
      if(saved){ document.documentElement.setAttribute('data-theme', saved); }
    }catch(e){}
  })();

/* ================= SUPABASE SETUP ================= */
  const SUPABASE_URL = 'https://scqxxjclhhhufjmnxogx.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjcXh4amNsaGhodWZqbW54b2d4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MTMyMzAsImV4cCI6MjA5OTE4OTIzMH0.6NXsrPDLTr1gNc78WTNa33V3AFrJWDhWgMzoUcVE7wk';
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true }
  });
  const EMAIL_DOMAIN = '@gmail.com';
  const EMAIL_TAG = '+ducklyapp';

  let currentUser = null;   // { id, email }
  let currentUsername = '';
  let authMode = 'login';   // 'login' | 'signup'
  let noteSaveTimer = null;
  let currentNoteId = null;
  let notesCache = [];

  function usernameToEmail(username){
    const clean = username.trim().toLowerCase().replace(/[^a-z0-9_.]/g, '');
    return clean + EMAIL_TAG + EMAIL_DOMAIN;
  }

  function showToast(msg){
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }

  function setAuthError(msg){
    const el = document.getElementById('authError');
    if(!msg){ el.classList.remove('show'); el.textContent = ''; return; }
    el.textContent = msg;
    el.classList.add('show');
  }

  function togglePasscodeVisibility(inputId, iconId){
    const input = document.getElementById(inputId);
    const icon = document.getElementById(iconId);
    if(input.type === 'password'){
      input.type = 'text';
      icon.innerHTML = `
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      `;
    } else {
      input.type = 'password';
      icon.innerHTML = `
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      `;
    }
  }

  function toggleAuthMode(){
    authMode = authMode === 'login' ? 'signup' : 'login';
    setAuthError('');
    const secFields = document.getElementById('signupSecurityFields');
    const forgotLink = document.getElementById('forgotPasscodeSwitch');
    
    if(authMode === 'signup'){
      document.getElementById('authTitle').textContent = 'Create your space';
      document.getElementById('authSub').textContent = 'Pick a username and passcode';
      document.getElementById('authBtnText').textContent = 'Create Account';
      document.getElementById('authSwitch').innerHTML = 'Already have an account? <a onclick="toggleAuthMode()">Sign in</a>';
      secFields.classList.remove('hidden');
      forgotLink.classList.add('hidden');
    } else {
      document.getElementById('authTitle').textContent = 'Welcome back';
      document.getElementById('authSub').textContent = 'Sign in to your Duckly space';
      document.getElementById('authBtnText').textContent = 'Sign In';
      document.getElementById('authSwitch').innerHTML = 'New here? <a onclick="toggleAuthMode()">Create an account</a>';
      secFields.classList.add('hidden');
      forgotLink.classList.remove('hidden');
    }
  }

  async function handleAuthSubmit(){
    const username = document.getElementById('authUsername').value.trim();
    const passcode = document.getElementById('authPasscode').value;
    setAuthError('');

    if(username.length < 3){ setAuthError('Username must be at least 3 characters.'); return; }
    if(passcode.length < 4){ setAuthError('Passcode must be at least 4 characters.'); return; }

    const btn = document.getElementById('authSubmitBtn');
    const btnText = document.getElementById('authBtnText');
    const originalText = btnText.textContent;
    btn.disabled = true;
    btnText.innerHTML = '<span class="spinner"></span>';

    const email = usernameToEmail(username);

    try{
      if(authMode === 'signup'){
        const question = document.getElementById('authQuestion').value;
        const answer = document.getElementById('authAnswer').value.trim();
        if(!answer){ setAuthError('Please answer the security question.'); return; }

        const { data, error } = await sb.auth.signUp({ email, password: passcode });
        if(error) throw error;
        if(data.user){
          const { error: profileErr } = await sb.from('profiles').insert({ 
            id: data.user.id, 
            username,
            security_question: question,
            security_answer: answer
          });
          if(profileErr && profileErr.code === '23505'){
            throw new Error('That username is already taken.');
          } else if(profileErr){
            throw profileErr;
          }
        }
        if(data.session){
          await onAuthSuccess(data.user, username);
        } else {
          setAuthError('Account created. Please sign in.');
          authMode = 'login'; toggleAuthMode();
        }
      } else {
        const { data, error } = await sb.auth.signInWithPassword({ email, password: passcode });
        if(error) throw error;
        const { data: profile } = await sb.from('profiles').select('username, theme, avatar_path').eq('id', data.user.id).single();
        await onAuthSuccess(data.user, profile ? profile.username : username, profile ? profile.theme : '', profile ? profile.avatar_path : null);
      }
    } catch(err){
      let msg = err.message || 'Something went wrong.';
      if(msg.includes('Invalid login credentials')) msg = 'Wrong username or passcode.';
      setAuthError(msg);
    } finally {
      btn.disabled = false;
      btnText.textContent = originalText;
    }
  }

  function openForgotPasswordModal(){
    document.getElementById('recoveryUsername').value = '';
    document.getElementById('recoveryAnswer').value = '';
    document.getElementById('recoveryNewPasscode').value = '';
    document.getElementById('recoveryError1').classList.remove('show');
    document.getElementById('recoveryError2').classList.remove('show');
    document.getElementById('recoveryStep1').classList.remove('hidden');
    document.getElementById('recoveryStep2').classList.add('hidden');
    document.getElementById('recoveryModal').classList.remove('hidden');
    pushBackEntry(closeForgotPasswordModal);
  }
  function closeForgotPasswordModal(){
    document.getElementById('recoveryModal').classList.add('hidden');
  }
  async function fetchSecurityQuestion(){
    const username = document.getElementById('recoveryUsername').value.trim();
    const errEl = document.getElementById('recoveryError1');
    errEl.classList.remove('show');

    if(!username){
      errEl.textContent = 'Please enter your username.';
      errEl.classList.add('show');
      return;
    }

    try {
      const { data, error } = await sb.rpc('get_user_question', { p_username: username });
      if(error) throw error;
      if(!data){
        errEl.textContent = 'Username not found or no security question set.';
        errEl.classList.add('show');
        return;
      }

      document.getElementById('recoveryQuestionText').textContent = data;
      document.getElementById('recoveryStep1').classList.add('hidden');
      document.getElementById('recoveryStep2').classList.remove('hidden');
    } catch(err) {
      errEl.textContent = err.message || 'Error fetching details.';
      errEl.classList.add('show');
    }
  }
  async function submitPasswordReset(){
    const username = document.getElementById('recoveryUsername').value.trim();
    const answer = document.getElementById('recoveryAnswer').value.trim();
    const newPasscode = document.getElementById('recoveryNewPasscode').value;
    const errEl = document.getElementById('recoveryError2');
    errEl.classList.remove('show');

    if(!answer){ errEl.textContent = 'Please enter your answer.'; errEl.classList.add('show'); return; }
    if(newPasscode.length < 4){ errEl.textContent = 'Passcode must be at least 4 characters.'; errEl.classList.add('show'); return; }

    const btn = document.getElementById('recoverySubmitBtn');
    const btnText = document.getElementById('recoveryBtnText');
    btn.disabled = true;
    btnText.innerHTML = '<span class="spinner"></span>';

    try {
      const { data, error } = await sb.rpc('reset_user_password', {
        p_username: username,
        p_answer: answer,
        p_new_password: newPasscode
      });

      if(error) throw error;

      if(data === true){
        showToast('Passcode reset successfully! You can now log in.');
        dismissTop();
      } else {
        errEl.textContent = 'Incorrect answer. Please try again.';
        errEl.classList.add('show');
      }
    } catch(err) {
      errEl.textContent = err.message || 'Reset failed.';
      errEl.classList.add('show');
    } finally {
      btn.disabled = false;
      btnText.textContent = 'Reset Passcode';
    }
  }

  /* ================= Shared re-auth helper =================
     Supabase's client SDK has no direct "verify current password" call while
     already logged in — the standard workaround is to attempt signInWithPassword
     again with the same email + the entered passcode. Success = correct passcode,
     and it's harmless (just refreshes the existing session). */
  async function reauthenticate(passcode){
    const email = usernameToEmail(currentUsername);
    const { error } = await sb.auth.signInWithPassword({ email, password: passcode });
    return !error;
  }

  function openChangeUsername(){
    document.getElementById('newUsernameInput').value = '';
    document.getElementById('usernameChangePasscode').value = '';
    document.getElementById('usernameChangeError').classList.remove('show');
    document.getElementById('settingsModal').classList.add('hidden');
    document.getElementById('changeUsernameModal').classList.remove('hidden');
    pushBackEntry(closeChangeUsernameModal);
  }
  function closeChangeUsernameModal(){
    document.getElementById('changeUsernameModal').classList.add('hidden');
    document.getElementById('settingsModal').classList.remove('hidden');
  }

  async function submitUsernameChange(){
    const newUsername = document.getElementById('newUsernameInput').value.trim();
    const passcode = document.getElementById('usernameChangePasscode').value;
    const errEl = document.getElementById('usernameChangeError');
    errEl.classList.remove('show');

    if(newUsername.length < 3){ errEl.textContent = 'Username must be at least 3 characters.'; errEl.classList.add('show'); return; }
    if(newUsername.toLowerCase() === currentUsername.toLowerCase()){ errEl.textContent = 'That\'s already your username.'; errEl.classList.add('show'); return; }
    if(!passcode){ errEl.textContent = 'Enter your current passcode to confirm.'; errEl.classList.add('show'); return; }

    const btn = document.getElementById('usernameChangeBtn');
    const btnText = document.getElementById('usernameChangeBtnText');
    btn.disabled = true;
    btnText.innerHTML = '<span class="spinner"></span>';

    try{
      const ok = await reauthenticate(passcode);
      if(!ok){ errEl.textContent = 'Incorrect passcode.'; errEl.classList.add('show'); return; }

      const { error: profileErr } = await sb.from('profiles').update({ username: newUsername }).eq('id', currentUser.id);
      if(profileErr){
        if(profileErr.code === '23505'){ errEl.textContent = 'That username is already taken.'; }
        else { errEl.textContent = 'Could not update username.'; }
        errEl.classList.add('show');
        return;
      }

      const { error: authErr } = await sb.auth.updateUser({ email: usernameToEmail(newUsername) });
      if(authErr){
        // Roll back the profile row so username + login email never drift apart.
        await sb.from('profiles').update({ username: currentUsername }).eq('id', currentUser.id);
        errEl.textContent = 'Could not update login — try again.';
        errEl.classList.add('show');
        return;
      }

      currentUsername = newUsername;
      document.getElementById('settingsUsername').textContent = newUsername;
      showToast('Username updated');
      dismissTop();
    } catch(err){
      errEl.textContent = err.message || 'Something went wrong.';
      errEl.classList.add('show');
    } finally {
      btn.disabled = false;
      btnText.textContent = 'Save Username';
    }
  }

  function openChangePasscode(){
    document.getElementById('passcodeChangeCurrent').value = '';
    document.getElementById('passcodeChangeNew').value = '';
    document.getElementById('passcodeChangeConfirm').value = '';
    document.getElementById('passcodeChangeError').classList.remove('show');
    document.getElementById('settingsModal').classList.add('hidden');
    document.getElementById('changePasscodeModal').classList.remove('hidden');
    pushBackEntry(closeChangePasscodeModal);
  }
  function closeChangePasscodeModal(){
    document.getElementById('changePasscodeModal').classList.add('hidden');
    document.getElementById('settingsModal').classList.remove('hidden');
  }

  async function submitPasscodeChange(){
    const current = document.getElementById('passcodeChangeCurrent').value;
    const next = document.getElementById('passcodeChangeNew').value;
    const confirm = document.getElementById('passcodeChangeConfirm').value;
    const errEl = document.getElementById('passcodeChangeError');
    errEl.classList.remove('show');

    if(!current){ errEl.textContent = 'Enter your current passcode.'; errEl.classList.add('show'); return; }
    if(next.length < 4){ errEl.textContent = 'New passcode must be at least 4 characters.'; errEl.classList.add('show'); return; }
    if(next !== confirm){ errEl.textContent = 'New passcodes do not match.'; errEl.classList.add('show'); return; }

    const btn = document.getElementById('passcodeChangeBtn');
    const btnText = document.getElementById('passcodeChangeBtnText');
    btn.disabled = true;
    btnText.innerHTML = '<span class="spinner"></span>';

    try{
      const ok = await reauthenticate(current);
      if(!ok){ errEl.textContent = 'Current passcode is incorrect.'; errEl.classList.add('show'); return; }

      const { error } = await sb.auth.updateUser({ password: next });
      if(error){ errEl.textContent = 'Could not update passcode.'; errEl.classList.add('show'); return; }

      showToast('Passcode updated');
      dismissTop();
    } catch(err){
      errEl.textContent = err.message || 'Something went wrong.';
      errEl.classList.add('show');
    } finally {
      btn.disabled = false;
      btnText.textContent = 'Save Passcode';
    }
  }

  let currentAvatarPath = null;

  async function onAuthSuccess(user, username, savedTheme, avatarPath){
    currentUser = user;
    currentUsername = username;
    currentAvatarPath = avatarPath || null;
    document.getElementById('loadingScreen').classList.add('hidden');
    document.getElementById('authWrapper').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
    document.getElementById('settingsUsername').textContent = username;
    await renderAvatar();

    if(savedTheme !== undefined && savedTheme !== null){
      applyTheme(savedTheme, false);
    }

    await loadNotes();
    await loadVaultItems();
    await loadCloudView();
    await calculateAndUpdateStorage();
    setTimeout(checkAndShowInstallBanner, 1500);
  }

  async function renderAvatar(){
    const el = document.getElementById('settingsAvatar');
    if(currentAvatarPath){
      const { data, error } = await sb.storage.from('avatars').createSignedUrl(currentAvatarPath, 3600);
      if(!error && data){
        el.innerHTML = `<img src="${data.signedUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
        return;
      }
    }
    el.innerHTML = '';
    el.textContent = currentUsername.charAt(0).toUpperCase();
  }

  async function handleAvatarSelect(event){
    const file = event.target.files[0];
    event.target.value = '';
    if(!file || !currentUser) return;
    if(!file.type.startsWith('image/')){ showToast('Please choose an image'); return; }
    if(file.size > 5 * 1024 * 1024){ showToast('Image too large — max 5MB'); return; }

    const path = currentUser.id + '/avatar_' + Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const { error: uploadErr } = await sb.storage.from('avatars').upload(path, file);
    if(uploadErr){ showToast('Could not upload photo'); return; }

    const oldPath = currentAvatarPath;
    const { error } = await sb.from('profiles').update({ avatar_path: path }).eq('id', currentUser.id);
    if(error){ showToast('Could not save photo'); return; }

    currentAvatarPath = path;
    await renderAvatar();
    showToast('Photo updated');

    if(oldPath){ sb.storage.from('avatars').remove([oldPath]).catch(()=>{}); }
  }

  async function quickLogout(){
    if(!(await showConfirm('You will need your username and passcode to sign in again.', 'Logout?', 'Logout'))) return;
    handleLogout();
  }

  async function handleLogout(){
    await sb.auth.signOut();
    currentUser = null;
    currentNoteId = null;
    clearStagedFile();
    document.getElementById('chat-scroll').innerHTML = '';
    cloudCurrentFolderId = null;
    cloudFolderStack = [{ id: null, name: 'Home' }];
    document.getElementById('appShell').classList.add('hidden');
    document.getElementById('authWrapper').classList.remove('hidden');
    document.getElementById('authUsername').value = '';
    document.getElementById('authPasscode').value = '';
    closeSettings();
    backStack = [];
    if(authMode !== 'login'){ toggleAuthMode(); }
  }

  async function checkExistingSession(){
    const { data } = await sb.auth.getSession();
    if(data.session){
      const { data: profile } = await sb.from('profiles').select('username, theme, avatar_path').eq('id', data.session.user.id).single();
      await onAuthSuccess(data.session.user, profile ? profile.username : 'You', profile ? profile.theme : '', profile ? profile.avatar_path : null);
    } else {
      document.getElementById('loadingScreen').classList.add('hidden');
      document.getElementById('authWrapper').classList.remove('hidden');
    }
  }
  checkExistingSession();

  if('serviceWorker' in navigator){
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  /* ================= NOTES (real Supabase CRUD) ================= */
  function timeAgo(dateStr){
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if(diff < 60) return 'Just now';
    if(diff < 3600) return Math.floor(diff/60) + 'm ago';
    if(diff < 86400) return Math.floor(diff/3600) + 'h ago';
    if(diff < 172800) return 'Yesterday';
    return Math.floor(diff/86400) + 'd ago';
  }

  async function loadNotes(){
    const { data, error } = await sb.from('notes').select('*').eq('user_id', currentUser.id).order('modified_at', { ascending:false });
    if(error){ showToast('Could not load notes'); return; }
    notesCache = data || [];
    renderNotesList();
  }

  function renderNotesList(){
    const list = document.getElementById('notes-list');
    const empty = document.getElementById('emptyNotes');
    list.innerHTML = '';
    if(notesCache.length === 0){
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    notesCache.forEach(note => {
      const card = document.createElement('div');
      card.className = 'note-card';
      const title = note.title && note.title.trim() ? note.title : 'Untitled note';
      const snippet = note.body && note.body.trim() ? note.body.slice(0,90) : 'No content yet';
      card.innerHTML = `
        <div class="card-actions">
          <button class="card-icon-btn" data-act="edit" title="Edit note">${EDIT_ICON}</button>
          <button class="card-icon-btn" data-act="copy" title="Copy note">${COPY_ICON}</button>
          <button class="card-icon-btn danger" data-act="delete" title="Delete note">${TRASH_ICON}</button>
        </div>
        <div class="select-checkbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
        <div class="title">${escapeHtml(title)}</div>
        <div class="snippet">${escapeHtml(snippet)}</div>
        <div class="date">Modified ${timeAgo(note.modified_at)}</div>
      `;
      card.addEventListener('click', (e) => {
        if(e.target.closest('.card-actions')) return;
        openNote(note.id);
      });
      card.querySelector('[data-act="edit"]').onclick = (e) => { e.stopPropagation(); openNote(note.id); };
      card.querySelector('[data-act="copy"]').onclick = (e) => {
        e.stopPropagation();
        const fullText = (note.title ? note.title + '\n\n' : '') + (note.body || '');
        navigator.clipboard.writeText(fullText).catch(()=>{});
        showToast('Note copied');
      };
      card.querySelector('[data-act="delete"]').onclick = (e) => { e.stopPropagation(); deleteNoteFromList(note.id); };
      const noteContextFn = () => ({ module:'notes', id: note.id, wrap: card });
      attachLongPressActions(card, noteContextFn);
      list.appendChild(card);
    });
  }

  async function deleteNoteFromList(noteId){
    if(!(await showConfirm('This note will be permanently deleted.', 'Delete note?'))) return;
    const { error } = await sb.from('notes').delete().eq('id', noteId);
    if(error){ showToast('Could not delete note'); return; }
    notesCache = notesCache.filter(n => n.id !== noteId);
    renderNotesList();
    showToast('Note deleted');
  }

  function openNote(noteId){
    const note = notesCache.find(n => n.id === noteId);
    if(!note) return;
    currentNoteId = noteId;
    document.getElementById('notes-list').style.display = 'none';
    document.getElementById('emptyNotes').classList.add('hidden');
    document.querySelector('.fab').style.display = 'none';
    document.getElementById('note-editor').classList.add('active');
    document.getElementById('editor-title').value = note.title || '';
    document.getElementById('editor-body').value = note.body || '';
  }

  async function newNote(){
    const { data, error } = await sb.from('notes').insert({ user_id: currentUser.id, title:'', body:'' }).select().single();
    if(error){ showToast('Could not create note'); return; }
    notesCache.unshift(data);
    openNote(data.id);
    document.getElementById('editor-title').focus();
  }

  function scheduleNoteSave(){
    if(!currentNoteId) return;
    clearTimeout(noteSaveTimer);
    noteSaveTimer = setTimeout(saveCurrentNote, 600);
  }

  async function saveCurrentNote(){
    if(!currentNoteId) return;
    const title = document.getElementById('editor-title').value;
    const body = document.getElementById('editor-body').value;
    const { data, error } = await sb.from('notes')
      .update({ title, body, modified_at: new Date().toISOString() })
      .eq('id', currentNoteId).select().single();
    if(error){ showToast('Could not save note'); return; }
    const idx = notesCache.findIndex(n => n.id === currentNoteId);
    if(idx !== -1) notesCache[idx] = data;
    notesCache.sort((a,b) => new Date(b.modified_at) - new Date(a.modified_at));
  }

  async function manualSaveNote(){
    if(!currentNoteId) return;
    clearTimeout(noteSaveTimer);
    const btn = document.getElementById('noteSaveBtn');
    const original = btn.textContent;
    await saveCurrentNote();
    btn.textContent = 'Saved ✓';
    setTimeout(() => { btn.textContent = original; }, 1200);
  }

  function copyCurrentNote(){
    if(!currentNoteId) return;
    const title = document.getElementById('editor-title').value;
    const body = document.getElementById('editor-body').value;
    const fullText = (title ? title + '\n\n' : '') + body;
    navigator.clipboard.writeText(fullText).catch(()=>{});
    showToast('Note copied');
  }

  async function deleteCurrentNote(){
    if(!currentNoteId) return;
    if(!(await showConfirm('This note will be permanently deleted.', 'Delete note?'))) return;
    const { error } = await sb.from('notes').delete().eq('id', currentNoteId);
    if(error){ showToast('Could not delete note'); return; }
    notesCache = notesCache.filter(n => n.id !== currentNoteId);
    closeNote();
    renderNotesList();
    showToast('Note deleted');
  }

  const titles = {chat:'Chat', cloud:'My Cloud', notes:'Notes'};
  const subs = {chat:'Message yourself, keep it safe', cloud:'Your files, organized by folder', notes:'Longer thoughts, kept tidy'};
  const TAB_ORDER = ['chat', 'cloud', 'notes'];
  let currentTabIndex = 0;

  /* ================= Unified Back Stack (History API) ================= */
  let backStack = [];
  let _suppressPop = false;

  function pushBackEntry(closeFn){
    backStack.push(closeFn);
    history.pushState({ duckly: backStack.length }, '');
  }

  function dismissTop(){
    if(backStack.length === 0) return;
    _suppressPop = true;
    const fn = backStack.pop();
    fn();
    history.back();
  }

  function dismissMultiple(n){
    if(n <= 0) return;
    _suppressPop = true;
    for(let i = 0; i < n; i++){
      const fn = backStack.pop();
      if(fn) fn();
    }
    history.go(-n);
  }

  window.addEventListener('popstate', () => {
    if(_suppressPop){ _suppressPop = false; return; }
    if(backStack.length > 0){
      const fn = backStack.pop();
      fn();
    }
  });

  function switchTab(tab){
    const newIndex = TAB_ORDER.indexOf(tab);
    if(newIndex === -1) return;
    if(selectionMode) exitSelectionMode();
    currentTabIndex = newIndex;

    document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
    document.getElementById('panelsTrack').classList.remove('dragging');
    document.getElementById('panelsTrack').style.transform = `translate3d(-${(currentTabIndex * 33.3333)}%, 0, 0)`;
    document.getElementById('topbar-title').textContent = titles[tab];
    document.getElementById('topbar-sub').textContent = subs[tab];
    document.getElementById('chatOptionsBtn').classList.toggle('hidden', tab !== 'chat');
    if(tab !== 'notes'){ closeNote(); }
  }

  function autoGrow(el){
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  function handleComposerKey(event){
    if(event.key === 'Enter' && !event.shiftKey){
      event.preventDefault();
      sendMsg();
    }
  }

  /* ---------- Chat rendering engine ---------- */
  const DOC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
  const TXT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>';
  const AUDIO_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  const ARCHIVE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v2m0 3v2m0 3v2m0 3v1"/></svg>';
  const SHEET_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 12h8M8 16h8M11 12v7"/></svg>';
  const SLIDE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
  const IMG_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
  const FOLDER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
  const DL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"/></svg>';
  const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg>';
  const CHEVRON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  const EDIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';

  function escapeHtml(str){
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function formatSize(bytes){
    if(bytes < 1024*1024) return Math.round(bytes/1024) + ' KB';
    return (bytes/1024/1024).toFixed(1) + ' MB';
  }

  function getExt(filename){
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop().toUpperCase().slice(0,4) : 'FILE';
  }

  function getTypeClass(ext){
    const e = ext.toLowerCase();
    if(e === 'pdf') return 'type-pdf';
    if(['doc','docx'].includes(e)) return 'type-doc';
    if(['xls','xlsx','csv'].includes(e)) return 'type-xls';
    if(['ppt','pptx'].includes(e)) return 'type-ppt';
    if(['jpg','jpeg','png','gif','webp'].includes(e)) return 'type-img';
    if(['htm','html'].includes(e)) return 'type-html';
    if(['txt','md'].includes(e)) return 'type-txt';
    if(['zip','rar','7z'].includes(e)) return 'type-zip';
    if(['mp3','wav','ogg','m4a','aac','flac'].includes(e)) return 'type-audio';
    return 'type-doc';
  }

  function getFileIcon(ext){
    const e = ext.toLowerCase();
    if(['doc','docx'].includes(e)) return DOC_ICON;
    if(['txt','md','htm','html'].includes(e)) return TXT_ICON;
    if(['xls','xlsx','csv'].includes(e)) return SHEET_ICON;
    if(['ppt','pptx'].includes(e)) return SLIDE_ICON;
    if(['zip','rar','7z'].includes(e)) return ARCHIVE_ICON;
    if(['mp3','wav','ogg','m4a','aac','flac'].includes(e)) return AUDIO_ICON;
    if(['jpg','jpeg','png','gif','webp'].includes(e)) return IMG_ICON;
    return DOC_ICON;
  }

  function renderTextBubble(item){
    const text = item.content || '';
    const time = new Date(item.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    const wrap = document.createElement('div');
    wrap.className = 'bubble';
    wrap.dataset.id = item.id;
    const safe = escapeHtml(text).replace(/\n/g, '<br>');
    const isLong = text.length > 240;
    const shortSafe = isLong ? escapeHtml(text.slice(0,240)).replace(/\n/g,'<br>') + '…' : safe;

    const textEl = document.createElement('div');
    textEl.className = 'bubble-text';
    textEl.innerHTML = shortSafe;
    if(isLong){
      const seeMore = document.createElement('span');
      seeMore.className = 'see-more';
      seeMore.textContent = 'See more';
      seeMore.dataset.expanded = 'false';
      seeMore.onclick = (e) => {
        e.stopPropagation();
        if(seeMore.dataset.expanded === 'false'){
          textEl.innerHTML = safe;
          textEl.appendChild(seeMore);
          seeMore.textContent = 'See less';
          seeMore.dataset.expanded = 'true';
        } else {
          textEl.innerHTML = shortSafe;
          textEl.appendChild(seeMore);
          seeMore.textContent = 'See more';
          seeMore.dataset.expanded = 'false';
        }
      };
      textEl.appendChild(seeMore);
    }

    const timeEl = document.createElement('div');
    timeEl.className = 'time';
    timeEl.style.textAlign = 'right';
    timeEl.style.marginTop = '4px';
    timeEl.style.paddingRight = '22px';
    timeEl.textContent = time;

    const chevron = document.createElement('button');
    chevron.className = 'bubble-chevron';
    chevron.title = 'Copy';
    chevron.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

    const checkbox = document.createElement('div');
    checkbox.className = 'select-checkbox';
    checkbox.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

    wrap.appendChild(textEl);
    wrap.appendChild(timeEl);
    wrap.appendChild(chevron);
    wrap.appendChild(checkbox);

    const contextFn = () => ({ module:'chat', type: 'text', id: item.id, wrap, text });
    attachLongPressActions(wrap, contextFn);
    attachChevron(chevron, contextFn);
    return wrap;
  }

  function renderFileBubble(item){
    const name = item.file_name || 'File';
    const sizeLabel = formatSize(item.file_size || 0);
    const time = new Date(item.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    const ext = getExt(name);
    const isImageExt = ['jpg','jpeg','png','gif','webp'].includes(ext.toLowerCase());
    const asPhoto = isImageExt && !item.send_as_document;

    const wrap = document.createElement('div');
    wrap.dataset.id = item.id;

    if(asPhoto){
      wrap.className = 'photo-bubble';
      wrap.innerHTML = `
        <div class="photo-thumb-wrap">
          <div class="photo-shimmer"></div>
          <img class="photo-thumb" style="display:none;">
        </div>
        <button class="photo-dl-btn" title="Download">${DL_ICON}</button>
        <button class="bubble-chevron" title="Options" style="bottom:8px; left:8px; right:auto;">${CHEVRON_ICON}</button>
        <div class="photo-time">${time}</div>
        <div class="select-checkbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
      `;
      const imgEl = wrap.querySelector('.photo-thumb');
      const shimmer = wrap.querySelector('.photo-shimmer');
      sb.storage.from('vault-files').createSignedUrl(item.file_path, 3600).then(({ data, error }) => {
        if(error) return;
        imgEl.src = data.signedUrl;
        imgEl.onload = () => { shimmer.style.display = 'none'; imgEl.style.display = 'block'; };
      });
      const doPhotoDownload = async () => {
        const { data, error } = await sb.storage.from('vault-files').createSignedUrl(item.file_path, 60);
        if(error){ showToast('Could not get download link'); return; }
        const res = await fetch(data.signedUrl);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
      };
      wrap.querySelector('.photo-dl-btn').onclick = (e) => { e.stopPropagation(); doPhotoDownload(); };
    } else {
      wrap.className = 'file-bubble';
      const typeClass = getTypeClass(ext);
      const icon = getFileIcon(ext);
      wrap.innerHTML = `
        <div class="file-icon ${typeClass}">
          ${icon}
          <span class="ext-ribbon">${ext}</span>
        </div>
        <div class="file-meta">
          <div class="name">${escapeHtml(name)}</div>
          <div class="size">${sizeLabel}</div>
          <div class="file-time">${time}</div>
        </div>
        <button class="dl-btn" title="Download">${DL_ICON}</button>
        <button class="bubble-chevron" title="Options">${CHEVRON_ICON}</button>
        <div class="select-checkbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
      `;
      const dlBtnEl = wrap.querySelector('.dl-btn');
      dlBtnEl.onclick = (e) => { e.stopPropagation(); downloadFile('vault-files', item.file_path, name, dlBtnEl); };

      if(ext.toLowerCase() === 'txt'){
        wrap.style.cursor = 'pointer';
        wrap.addEventListener('click', (e) => {
          if(e.target.closest('.dl-btn') || e.target.closest('.bubble-chevron')) return;
          openTextPreview('vault-files', item.file_path, name, 'vault_items', item.id);
        });
      }
    }

    const contextFn = () => ({ module:'chat', type: 'file', id: item.id, wrap, filePath: item.file_path, fileSize: item.file_size });
    attachLongPressActions(wrap, contextFn);
    const chevronEl = wrap.querySelector('.bubble-chevron');
    if(chevronEl) attachChevron(chevronEl, contextFn);
    return wrap;
  }

  const MAX_FILE_SIZE = 300 * 1024 * 1024;
  const TOTAL_QUOTA = 500 * 1024 * 1024;
  let totalUsedBytes = 0;
  let chatUsedBytes = 0;
  let cloudUsedBytes = 0;
  let stagedFile = null;

  async function loadVaultItems(){
    const { data, error } = await sb.from('vault_items').select('*').eq('user_id', currentUser.id).order('created_at', { ascending:true });
    if(error){ showToast('Could not load chat'); return; }
    const scroll = document.getElementById('chat-scroll');
    scroll.innerHTML = '';
    if(data && data.length){
      const divider = document.createElement('div');
      divider.className = 'day-divider';
      divider.textContent = 'History';
      scroll.appendChild(divider);
      data.forEach(item => {
        scroll.appendChild(item.type === 'text' ? renderTextBubble(item) : renderFileBubble(item));
      });
    }
    scroll.scrollTop = scroll.scrollHeight;
  }

  async function calculateAndUpdateStorage(){
    const [vaultRes, cloudRes] = await Promise.all([
      sb.from('vault_items').select('file_size').eq('user_id', currentUser.id).eq('type', 'file'),
      sb.from('cloud_files').select('file_size').eq('user_id', currentUser.id)
    ]);
    let chatBytes = 0, cloudBytes = 0;
    (vaultRes.data || []).forEach(r => { chatBytes += r.file_size || 0; });
    (cloudRes.data || []).forEach(r => { cloudBytes += r.file_size || 0; });
    chatUsedBytes = chatBytes;
    cloudUsedBytes = cloudBytes;
    updateStorageUI(chatBytes + cloudBytes);
    updateStorageBreakdownUI();
  }

  function updateStorageBreakdownUI(){
    const chatMB = chatUsedBytes / (1024 * 1024);
    const cloudMB = cloudUsedBytes / (1024 * 1024);
    const totalMB = (chatUsedBytes + cloudUsedBytes) / (1024 * 1024);
    const fmt = (mb) => mb < 10 ? mb.toFixed(1) : Math.round(mb);

    const rowEl = document.getElementById('settingsRowStorage');
    if(rowEl) rowEl.textContent = fmt(totalMB) + ' MB used';

    const chatLbl = document.getElementById('storageBreakdownChat');
    const cloudLbl = document.getElementById('storageBreakdownCloud');
    const totalLbl = document.getElementById('storageBreakdownTotal');
    if(chatLbl) chatLbl.textContent = fmt(chatMB) + ' MB';
    if(cloudLbl) cloudLbl.textContent = fmt(cloudMB) + ' MB';
    if(totalLbl) totalLbl.textContent = fmt(totalMB) + ' MB / 500 MB';

    const quotaMB = TOTAL_QUOTA / (1024 * 1024);
    const chatPct = Math.min(100, (chatMB / quotaMB) * 100);
    const cloudPct = Math.min(100, (cloudMB / quotaMB) * 100);
    const barChat = document.getElementById('storageBarChat');
    const barCloud = document.getElementById('storageBarCloud');
    if(barChat) barChat.style.width = chatPct + '%';
    if(barCloud) barCloud.style.width = cloudPct + '%';
  }

  function updateStorageUI(usedBytes){
    totalUsedBytes = usedBytes;
    const percent = Math.min(100, (usedBytes / TOTAL_QUOTA) * 100);
    const usedMB = usedBytes / (1024 * 1024);
    const usedLabel = usedMB < 10 ? usedMB.toFixed(1) : Math.round(usedMB);

    document.querySelectorAll('.storage-pill .bar-fill').forEach(el => { el.style.width = percent + '%'; });
    document.querySelectorAll('.storage-pill .txt').forEach(el => { el.innerHTML = '<b>' + usedLabel + ' MB</b> / 500 MB'; });

    const circumference = 2 * Math.PI * 21;
    const offset = circumference * (1 - percent / 100);
    const gaugeFill = document.querySelector('.gauge-fill');
    if(gaugeFill){
      gaugeFill.setAttribute('stroke-dasharray', circumference.toFixed(1));
      gaugeFill.setAttribute('stroke-dashoffset', offset.toFixed(1));
    }
    const gaugeLabel = document.querySelector('.gauge-label');
    if(gaugeLabel){ gaugeLabel.textContent = Math.round(percent) + '%'; }
  }

  function handleFileSelect(event){
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if(!files.length) return;

    if(files.length === 1){
      const file = files[0];
      if(file.size > MAX_FILE_SIZE){
        showToast('File too large — max 300MB');
        return;
      }
      setStagedFile(file);
      return;
    }

    const oversized = files.filter(f => f.size > MAX_FILE_SIZE);
    const valid = files.filter(f => f.size <= MAX_FILE_SIZE);
    if(oversized.length){
      showToast(oversized.length + ' file(s) skipped — over 300MB limit');
    }
    if(valid.length) sendMultipleFiles(valid);
  }

  async function sendMultipleFiles(files){
    const sendBtn = document.getElementById('sendBtn');
    sendBtn.disabled = true;
    let sentCount = 0;
    for(const file of files){
      sentCount++;
      showToast(`Sending ${sentCount}/${files.length}…`);
      try{
        stagedSendAsDocument = false;
        await sendFileMessage(file, '');
      } catch(err){
        showToast((err.message || 'Send failed') + ` (${file.name})`);
      }
    }
    sendBtn.disabled = false;
    showToast(`Sent ${sentCount}/${files.length} file(s)`);
  }

  let stagedSendAsDocument = false;
  let stagedThumbUrl = null;

  function setStagedFile(file){
    stagedFile = file;
    stagedSendAsDocument = false;
    const ext = getExt(file.name);
    const isImage = ['jpg','jpeg','png','gif','webp'].includes(ext.toLowerCase());

    document.getElementById('stagedExt').textContent = ext;
    document.getElementById('stagedName').textContent = file.name;
    document.getElementById('stagedSize').textContent = formatSize(file.size);
    document.getElementById('stagedPreview').classList.remove('hidden');
    document.getElementById('stagedDocToggle').classList.toggle('hidden', !isImage);
    document.getElementById('stagedDocToggle').textContent = 'Send as Document instead';

    if(stagedThumbUrl){ URL.revokeObjectURL(stagedThumbUrl); stagedThumbUrl = null; }

    if(isImage){
      stagedThumbUrl = URL.createObjectURL(file);
      document.getElementById('stagedIcon').innerHTML = '<img src="' + stagedThumbUrl + '" style="width:100%; height:100%; object-fit:cover;">';
      document.getElementById('stagedIcon').className = 'file-icon';
      document.getElementById('stagedIcon').style.background = 'transparent';
    } else {
      document.getElementById('stagedIcon').style.background = '';
      document.getElementById('stagedIcon').className = 'file-icon ' + getTypeClass(ext);
      document.getElementById('stagedIcon').innerHTML = getFileIcon(ext) + '<span class="ext-ribbon" id="stagedExt">' + ext + '</span>';
    }
    document.getElementById('chat-input').focus();
  }

  function toggleStagedSendAsDocument(){
    if(!stagedFile) return;
    stagedSendAsDocument = !stagedSendAsDocument;
    const ext = getExt(stagedFile.name);
    const toggle = document.getElementById('stagedDocToggle');
    if(stagedSendAsDocument){
      document.getElementById('stagedIcon').className = 'file-icon ' + getTypeClass(ext);
      document.getElementById('stagedIcon').style.background = '';
      document.getElementById('stagedIcon').innerHTML = getFileIcon(ext) + '<span class="ext-ribbon">' + ext + '</span>';
      toggle.textContent = 'Send as Photo instead';
    } else {
      document.getElementById('stagedIcon').className = 'file-icon';
      document.getElementById('stagedIcon').style.background = 'transparent';
      document.getElementById('stagedIcon').innerHTML = '<img src="' + stagedThumbUrl + '" style="width:100%; height:100%; object-fit:cover;">';
      toggle.textContent = 'Send as Document instead';
    }
  }

  function clearStagedFile(){
    stagedFile = null;
    stagedSendAsDocument = false;
    if(stagedThumbUrl){ URL.revokeObjectURL(stagedThumbUrl); stagedThumbUrl = null; }
    document.getElementById('stagedPreview').classList.add('hidden');
  }

  async function sendMsg(){
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if(!text && !stagedFile) return;

    const sendBtn = document.getElementById('sendBtn');
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span class="spinner" style="border-color:rgba(255,255,255,0.4); border-top-color:#fff;"></span>';

    try{
      if(stagedFile){
        await sendFileMessage(stagedFile, text);
        clearStagedFile();
      } else {
        await sendTextMessage(text);
      }
      input.value = '';
      input.style.height = '46px';
    } catch(err){
      showToast(err.message || 'Send failed');
    } finally {
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/></svg>';
    }
  }

  async function sendTextMessage(text){
    const { data, error } = await sb.from('vault_items').insert({
      user_id: currentUser.id, type: 'text', content: text
    }).select().single();
    if(error) throw error;
    const scroll = document.getElementById('chat-scroll');
    scroll.appendChild(renderTextBubble(data));
    scroll.scrollTop = scroll.scrollHeight;
  }

  async function sendFileMessage(file, caption){
    if(totalUsedBytes + file.size > TOTAL_QUOTA){
      throw new Error('Storage full — delete some files first (500MB limit reached).');
    }

    const path = currentUser.id + '/' + Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const { error: uploadErr } = await sb.storage.from('vault-files').upload(path, file);
    if(uploadErr) throw uploadErr;

    if(caption){
      await sendTextMessage(caption);
    }

    const { data, error } = await sb.from('vault_items').insert({
      user_id: currentUser.id, type: 'file',
      file_name: file.name, file_path: path, file_size: file.size,
      send_as_document: stagedSendAsDocument
    }).select().single();
    if(error) throw error;
    const scroll = document.getElementById('chat-scroll');
    scroll.appendChild(renderFileBubble(data));
    scroll.scrollTop = scroll.scrollHeight;

    await calculateAndUpdateStorage();
    if(totalUsedBytes / TOTAL_QUOTA >= 0.9){
      showToast('Storage almost full — consider deleting old files');
    }
  }

  async function openImagePreview(bucket, path, filename){
    const img = document.getElementById('lightboxImg');
    const spinner = document.getElementById('lightboxSpinner');
    img.style.display = 'none';
    img.src = '';
    spinner.style.display = '';
    document.getElementById('lightboxDlBtn').onclick = () => downloadFile(bucket, path, filename, document.getElementById('lightboxDlBtn'));
    document.getElementById('lightboxModal').classList.remove('hidden');
    pushBackEntry(hideLightbox);

    const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 3600);
    if(error){ showToast('Could not load image'); hideLightbox(); return; }
    img.onload = () => { spinner.style.display = 'none'; img.style.display = ''; };
    img.src = data.signedUrl;
  }

  function hideLightbox(){
    document.getElementById('lightboxModal').classList.add('hidden');
    document.getElementById('lightboxImg').src = '';
  }

  function closeLightbox(){
    dismissTop();
  }

  let _textPreviewCtx = null; // { bucket, path, filename, table, id }
  let _textPreviewOriginal = '';

  function openTextPreview(bucket, path, filename, table, id){
    _textPreviewCtx = { bucket, path, filename, table, id };
    _textPreviewOriginal = '';

    const nameEl = document.getElementById('textPreviewName');
    nameEl.textContent = filename;
    const ta = document.getElementById('textPreviewArea');
    ta.value = 'Loading…';
    ta.disabled = true;

    document.getElementById('textPreviewDlBtn').onclick = () => downloadFile(bucket, path, filename, document.getElementById('textPreviewDlBtn'));

    // Open instantly — don't wait on the network before showing the modal.
    document.getElementById('textPreviewModal').classList.remove('hidden');
    pushBackEntry(hideTextPreview);

    (async () => {
      const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 3600);
      if(error){ ta.value = ''; ta.disabled = false; showToast('Could not load file'); return; }
      try{
        const res = await fetch(data.signedUrl);
        ta.value = await res.text();
        _textPreviewOriginal = ta.value;
      } catch(e){
        showToast('Could not load file');
      } finally {
        ta.disabled = false;
      }
    })();
  }

  function hideTextPreview(){
    document.getElementById('textPreviewModal').classList.add('hidden');
    document.getElementById('textPreviewArea').value = '';
    cancelTextPreviewRename();
    _textPreviewCtx = null;
    _textPreviewOriginal = '';
  }

  async function closeTextPreview(){
    const ta = document.getElementById('textPreviewArea');
    if(!ta.disabled && ta.value !== _textPreviewOriginal){
      const ok = await showConfirm('Changes you made will be lost. Close anyway?', 'Unsaved changes', 'Discard');
      if(!ok) return;
    }
    dismissTop();
  }

  async function saveTextPreview(){
    if(!_textPreviewCtx) return;
    const { bucket, path, table, id } = _textPreviewCtx;
    const ta = document.getElementById('textPreviewArea');
    const text = ta.value;
    const blob = new Blob([text], { type: 'text/plain' });

    showToast('Saving…');
    const { error } = await sb.storage.from(bucket).upload(path, blob, { upsert: true, contentType: 'text/plain' });
    if(error){ showToast('Save failed'); return; }

    if(table && id){
      await sb.from(table).update({ file_size: blob.size }).eq('id', id);
      calculateAndUpdateStorage();
    }
    _textPreviewOriginal = text;
    showToast('Saved');
  }

  document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('textPreviewModal');
    if(!modal || modal.classList.contains('hidden')) return;
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's'){
      e.preventDefault();
      saveTextPreview();
    }
  });

  document.getElementById('textPreviewCopyBtn').onclick = async () => {
    try{
      await navigator.clipboard.writeText(document.getElementById('textPreviewArea').value);
      showToast('Copied');
    } catch(e){
      showToast('Copy failed');
    }
  };

  document.getElementById('textPreviewPasteBtn').onclick = async () => {
    try{
      const clip = await navigator.clipboard.readText();
      const ta = document.getElementById('textPreviewArea');
      const start = ta.selectionStart, end = ta.selectionEnd;
      ta.value = ta.value.slice(0, start) + clip + ta.value.slice(end);
      ta.selectionStart = ta.selectionEnd = start + clip.length;
      ta.focus();
    } catch(e){
      showToast('Paste failed — clipboard permission needed');
    }
  };

  document.getElementById('textPreviewClearBtn').onclick = () => {
    document.getElementById('textPreviewArea').value = '';
    document.getElementById('textPreviewArea').focus();
  };

  /* ---- Rename (edits DB display name only, storage path unchanged) ---- */
  function cancelTextPreviewRename(){
    const nameEl = document.getElementById('textPreviewName');
    const input = document.getElementById('textPreviewNameInput');
    if(input) input.remove();
    if(nameEl) nameEl.style.display = '';
  }

  function startTextPreviewRename(){
    if(!_textPreviewCtx) return;
    const nameEl = document.getElementById('textPreviewName');
    if(document.getElementById('textPreviewNameInput')) return; // already editing
    nameEl.style.display = 'none';
    const input = document.createElement('input');
    input.id = 'textPreviewNameInput';
    input.value = _textPreviewCtx.filename;
    input.style.cssText = 'font-size:15px; font-weight:700; font-family:inherit; width:100%; border:1px solid var(--border); border-radius:8px; padding:6px 10px; background:var(--bg); color:var(--ink); outline:none;';
    nameEl.parentNode.insertBefore(input, nameEl);
    input.focus();
    input.select();

    const commit = async () => {
      const newName = input.value.trim();
      if(!newName || newName === _textPreviewCtx.filename){ cancelTextPreviewRename(); return; }
      const { table, id } = _textPreviewCtx;
      const { error } = await sb.from(table).update({ file_name: newName }).eq('id', id);
      if(error){ showToast('Rename failed'); cancelTextPreviewRename(); return; }
      _textPreviewCtx.filename = newName;
      nameEl.textContent = newName;
      cancelTextPreviewRename();
      showToast('Renamed');
      if(table === 'cloud_files') loadCloudView();
      else if(table === 'vault_items') loadVaultItems();
    };

    input.addEventListener('keydown', (e) => {
      if(e.key === 'Enter'){ e.preventDefault(); commit(); }
      if(e.key === 'Escape'){ e.preventDefault(); cancelTextPreviewRename(); }
    });
    input.addEventListener('blur', commit);
  }



  async function downloadFile(bucket, path, filename, btnEl){
    const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 60);
    if(error){ showToast('Could not get download link'); return; }

    const originalHTML = btnEl.innerHTML;
    btnEl.disabled = true;

    try{
      const res = await fetch(data.signedUrl);
      const total = parseInt(res.headers.get('Content-Length') || '0', 10);
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;

      while(true){
        const { done, value } = await reader.read();
        if(done) break;
        chunks.push(value);
        received += value.length;
        if(total){
          const pct = Math.min(100, Math.round((received / total) * 100));
          btnEl.innerHTML = '<span class="mono" style="font-size:9.5px; font-weight:700;">' + pct + '%</span>';
        }
      }

      const blob = new Blob(chunks);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
    } catch(e){
      showToast('Download failed');
    } finally {
      btnEl.disabled = false;
      btnEl.innerHTML = originalHTML;
    }
  }

  function downloadVaultFile(path, filename, btnEl){
    return downloadFile('vault-files', path, filename, btnEl);
  }

  async function deleteVaultItem(id, domEl, filePath, fileSize){
    if(filePath){
      await sb.storage.from('vault-files').remove([filePath]);
    }
    const { error } = await sb.from('vault_items').delete().eq('id', id);
    if(error){ showToast('Could not delete'); return; }
    domEl.remove();
    if(fileSize){
      await calculateAndUpdateStorage();
    }
  }

  function scrollChatBottom(){
    const scroll = document.getElementById('chat-scroll');
    scroll.scrollTo({top: scroll.scrollHeight, behavior:'smooth'});
  }

  function setupScrollWatcher(){
    const scroll = document.getElementById('chat-scroll');
    const btn = document.getElementById('scrollBottomBtn');
    scroll.addEventListener('scroll', () => {
      const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 60;
      btn.classList.toggle('show', !nearBottom);
    });
  }

  function setupPasteHandler(){
    const input = document.getElementById('chat-input');
    input.addEventListener('paste', (e) => {
      const files = e.clipboardData && e.clipboardData.files;
      if(files && files.length > 0){
        e.preventDefault();
        const file = files[0];
        if(file.size > MAX_FILE_SIZE){ showToast('File too large — max 300MB'); return; }
        setStagedFile(file);
      }
    });
  }

  /* ================= MY CLOUD MODULE ================= */
  let cloudCurrentFolderId = null;
  let cloudFolderStack = [{ id: null, name: 'Home' }];
  let cloudViewMode = 'grid';
  try{ cloudViewMode = localStorage.getItem('duckly-cloud-view') || 'grid'; }catch(e){}
  document.querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === cloudViewMode);
  });

  async function loadCloudView(){
    if(!currentUser) return;
    renderCloudBreadcrumb();
    const gridsWrap = document.getElementById('cloudGridsWrap');
    gridsWrap.style.opacity = '0.4';

    const folderQuery = cloudCurrentFolderId === null
      ? sb.from('cloud_folders').select('*').eq('user_id', currentUser.id).is('parent_folder_id', null)
      : sb.from('cloud_folders').select('*').eq('user_id', currentUser.id).eq('parent_folder_id', cloudCurrentFolderId);
    const fileQuery = cloudCurrentFolderId === null
      ? sb.from('cloud_files').select('*').eq('user_id', currentUser.id).eq('is_trashed', false).is('folder_id', null)
      : sb.from('cloud_files').select('*').eq('user_id', currentUser.id).eq('is_trashed', false).eq('folder_id', cloudCurrentFolderId);

    const [{ data: folders, error: fErr }, { data: files, error: fiErr }] = await Promise.all([folderQuery, fileQuery]);
    if(fErr || fiErr){ showToast('Could not load My Cloud'); gridsWrap.style.opacity = '1'; return; }

    const foldersGrid = document.getElementById('cloudFoldersGrid');
    const filesGrid = document.getElementById('cloudFilesGrid');
    const foldersSection = document.getElementById('cloudFoldersSection');
    const filesSection = document.getElementById('cloudFilesSection');
    const emptyState = document.getElementById('cloudEmptyState');
    foldersGrid.innerHTML = '';
    filesGrid.innerHTML = '';

    const isListMode = cloudViewMode === 'list';
    foldersGrid.className = isListMode ? 'grid list-mode' : 'grid';
    filesGrid.className = isListMode ? 'grid list-mode' : 'grid';
    document.getElementById('cloudListHeader').classList.toggle('hidden', !isListMode || (!folders?.length && !files?.length));

    (folders || []).forEach(folder => {
      const el = document.createElement('div');
      if(isListMode){
        el.className = 'list-row';
        el.innerHTML = `
          <button class="card-del-btn" title="Delete folder">${TRASH_ICON}</button>
          <div class="list-icon folder-real">${FOLDER_ICON}</div>
          <div class="list-name">${escapeHtml(folder.name)}</div>
          <div class="list-modified">${formatListDate(folder.created_at)}</div>
          <div class="list-size">—</div>
        `;
      } else {
        el.className = 'card';
        el.innerHTML = `
          <button class="card-del-btn" title="Delete folder">${TRASH_ICON}</button>
          <div class="file-icon folder-real">${FOLDER_ICON}</div>
          <div class="name">${escapeHtml(folder.name)}</div>
          <div class="size">Folder</div>
        `;
      }
      el.addEventListener('click', (e) => {
        if(e.target.closest('.card-del-btn')) return;
        navigateToFolder(folder.id, folder.name);
      });
      el.querySelector('.card-del-btn').onclick = (e) => { e.stopPropagation(); deleteFolder(folder.id, folder.name); };
      foldersGrid.appendChild(el);
    });

    (files || []).forEach(file => {
      const ext = getExt(file.file_name);
      const typeClass = getTypeClass(ext);
      const isImage = ['jpg','jpeg','png','gif','webp'].includes(ext.toLowerCase());
      const el = document.createElement('div');
      const checkboxHtml = `<div class="select-checkbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>`;
      let iconEl;
      if(isListMode){
        el.className = 'list-row';
        el.innerHTML = `
          <button class="card-del-btn" title="Delete file">${TRASH_ICON}</button>
          ${checkboxHtml}
          <div class="list-icon ${typeClass}">${getFileIcon(ext)}</div>
          <div class="list-name">${escapeHtml(file.file_name)}</div>
          <div class="list-modified">${formatListDate(file.created_at)}</div>
          <div class="list-size">${formatSize(file.file_size)}</div>
        `;
        iconEl = el.querySelector('.list-icon');
      } else {
        el.className = 'card';
        el.innerHTML = `
          <button class="card-del-btn" title="Delete file">${TRASH_ICON}</button>
          ${checkboxHtml}
          <div class="file-icon ${typeClass}">${getFileIcon(ext)}<span class="ext-ribbon">${ext}</span></div>
          <div class="name">${escapeHtml(file.file_name)}</div>
          <div class="size">${formatSize(file.file_size)}</div>
        `;
        iconEl = el.querySelector('.file-icon');
      }
      if(isImage) loadCloudThumbnail(iconEl, file.file_path);
      el.addEventListener('click', (e) => {
        if(e.target.closest('.card-del-btn')) return;
        if(isImage){
          openImagePreview('cloud-files', file.file_path, file.file_name);
        } else if(ext.toLowerCase() === 'txt'){
          openTextPreview('cloud-files', file.file_path, file.file_name, 'cloud_files', file.id);
        } else {
          downloadFile('cloud-files', file.file_path, file.file_name, iconEl);
        }
      });
      el.querySelector('.card-del-btn').onclick = (e) => { e.stopPropagation(); trashFile(file.id, file.file_size); };
      const cloudContextFn = () => ({ module:'cloud', id: file.id, wrap: el, filePath: file.file_path, fileSize: file.file_size, filename: file.file_name });
      attachLongPressActions(el, cloudContextFn);
      filesGrid.appendChild(el);
    });

    foldersSection.classList.toggle('hidden', !folders || folders.length === 0);
    filesSection.classList.toggle('hidden', !files || files.length === 0);
    emptyState.classList.toggle('hidden', (folders && folders.length) || (files && files.length));
    gridsWrap.style.opacity = '1';
  }

  function formatListDate(iso){
    if(!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString([], { month:'short', day:'numeric', year:'numeric' });
  }

  async function loadCloudThumbnail(iconEl, filePath){
    if(!iconEl) return;
    const { data, error } = await sb.storage.from('cloud-files').createSignedUrl(filePath, 3600);
    if(error) return;
    const img = new Image();
    img.onload = () => {
      iconEl.style.backgroundImage = `url(${data.signedUrl})`;
      iconEl.style.backgroundSize = 'cover';
      iconEl.style.backgroundPosition = 'center';
      iconEl.classList.add('has-thumb');
    };
    img.src = data.signedUrl;
  }

  function setCloudViewMode(mode){
    cloudViewMode = mode;
    try{ localStorage.setItem('duckly-cloud-view', mode); }catch(e){}
    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === mode);
    });
    loadCloudView();
  }

  function renderCloudBreadcrumb(){
    const bc = document.getElementById('cloudBreadcrumb');
    bc.innerHTML = '';
    cloudFolderStack.forEach((entry, idx) => {
      if(idx > 0){
        const sep = document.createElement('span');
        sep.textContent = '›';
        bc.appendChild(sep);
      }
      const span = document.createElement('span');
      span.textContent = entry.name;
      if(idx === cloudFolderStack.length - 1){
        span.className = 'here';
      } else {
        span.style.cursor = 'pointer';
        span.onclick = () => {
          const stepsBack = cloudFolderStack.length - 1 - idx;
          dismissMultiple(stepsBack);
        };
      }
      bc.appendChild(span);
    });
    document.getElementById('cloudBackBtn').style.visibility = cloudFolderStack.length > 1 ? 'visible' : 'hidden';
  }

  function navigateCloudBack(){
    if(cloudFolderStack.length <= 1) return;
    dismissTop();
  }

  function navigateToFolder(id, name){
    cloudFolderStack.push({ id, name });
    cloudCurrentFolderId = id;
    loadCloudView();
    pushBackEntry(() => {
      cloudFolderStack.pop();
      cloudCurrentFolderId = cloudFolderStack[cloudFolderStack.length - 1].id;
      loadCloudView();
    });
  }

  async function promptNewFolder(){
    const name = await showPrompt('New folder', 'e.g. Client Docs');
    if(!name) return;
    const { error } = await sb.from('cloud_folders').insert({
      user_id: currentUser.id, name, parent_folder_id: cloudCurrentFolderId
    });
    if(error){ showToast('Could not create folder'); return; }
    loadCloudView();
  }

  async function deleteFolder(id, name){
    const { data: children } = await sb.from('cloud_folders').select('id').eq('parent_folder_id', id);
    const { data: files } = await sb.from('cloud_files').select('id').eq('folder_id', id).eq('is_trashed', false);
    if((children && children.length) || (files && files.length)){
      showToast('Folder not empty — move or delete its contents first');
      return;
    }
    if(!(await showConfirm('"' + name + '" will be permanently deleted.', 'Delete folder?'))) return;
    const { error } = await sb.from('cloud_folders').delete().eq('id', id);
    if(error){ showToast('Could not delete folder'); return; }
    loadCloudView();
  }

  function toggleCloudUploadMenu(e){
    e.stopPropagation();
    const menu = document.getElementById('cloudUploadMenu');
    menu.classList.toggle('hidden');
  }

  function closeCloudUploadMenu(){
    document.getElementById('cloudUploadMenu').classList.add('hidden');
  }

  document.addEventListener('click', (e) => {
    const menu = document.getElementById('cloudUploadMenu');
    if(!menu || menu.classList.contains('hidden')) return;
    if(!e.target.closest('#cloudUploadMenu') && !e.target.closest('.cloud-actions')) closeCloudUploadMenu();
  });

  document.getElementById('cloudUploadMenu').querySelector('[data-act="files"]').onclick = () => {
    closeCloudUploadMenu();
    document.getElementById('cloudFileInput').click();
  };
  document.getElementById('cloudUploadMenu').querySelector('[data-act="folder"]').onclick = () => {
    closeCloudUploadMenu();
    document.getElementById('cloudFolderInput').click();
  };

  function handleCloudFileSelect(event){
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if(!files.length) return;
    uploadCloudFilesBatch(files);
  }

  function handleCloudFolderSelect(event){
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if(!files.length) return;
    uploadFolderTree(files);
  }

  async function uploadCloudFile(file, opts){
    opts = opts || {};
    const silent = opts.silent || false;
    const folderId = (opts.folderId !== undefined) ? opts.folderId : cloudCurrentFolderId;

    if(file.size > MAX_FILE_SIZE){ showToast('Too large, skipped: ' + file.name); return false; }
    if(totalUsedBytes + file.size > TOTAL_QUOTA){ showToast('Storage full — stopped at: ' + file.name); return false; }

    const path = currentUser.id + '/' + Date.now() + '_' + Math.random().toString(36).slice(2,7) + '_' + file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const { error: uploadErr } = await sb.storage.from('cloud-files').upload(path, file);
    if(uploadErr){ showToast('Upload failed: ' + file.name); return false; }

    const { error } = await sb.from('cloud_files').insert({
      user_id: currentUser.id, folder_id: folderId,
      file_name: file.name, file_path: path, file_size: file.size
    });
    if(error){ showToast('Could not save file record: ' + file.name); return false; }

    totalUsedBytes += file.size;

    if(!silent){
      showToast('Uploaded');
      await loadCloudView();
      await calculateAndUpdateStorage();
      if(totalUsedBytes / TOTAL_QUOTA >= 0.9){
        showToast('Storage almost full — consider deleting old files');
      }
    }
    return true;
  }

  async function uploadCloudFilesBatch(files){
    if(!files.length) return;
    let count = 0;
    for(const file of files){
      count++;
      showToast(`Uploading ${count}/${files.length}…`);
      await uploadCloudFile(file, { silent:true });
    }
    showToast(`Uploaded ${count} file(s)`);
    await loadCloudView();
    await calculateAndUpdateStorage();
  }

  async function uploadFolderTree(files){
    if(!files.length) return;
    const folderIdCache = new Map();
    folderIdCache.set('', cloudCurrentFolderId);

    async function resolveFolderId(dirPath){
      if(folderIdCache.has(dirPath)) return folderIdCache.get(dirPath);
      const parts = dirPath.split('/');
      const folderName = parts[parts.length - 1];
      const parentPath = parts.slice(0, -1).join('/');
      const parentId = await resolveFolderId(parentPath);
      const { data, error } = await sb.from('cloud_folders')
        .insert({ user_id: currentUser.id, name: folderName, parent_folder_id: parentId })
        .select().single();
      const resolvedId = error ? parentId : data.id;
      folderIdCache.set(dirPath, resolvedId);
      return resolvedId;
    }

    let count = 0;
    for(const file of files){
      count++;
      showToast(`Uploading ${count}/${files.length}…`);
      const relPath = file.webkitRelativePath || file.name;
      const dirPath = relPath.split('/').slice(0, -1).join('/');
      const folderId = await resolveFolderId(dirPath);
      await uploadCloudFile(file, { silent:true, folderId });
    }
    showToast(`Uploaded ${count} file(s)`);
    await loadCloudView();
    await calculateAndUpdateStorage();
  }

  async function trashFile(id, fileSize){
    if(!(await showConfirm('This file will be moved to Trash.', 'Move to Trash?'))) return;
    const { error } = await sb.from('cloud_files').update({ is_trashed: true }).eq('id', id);
    if(error){ showToast('Could not delete'); return; }
    loadCloudView();
  }

  function openTrashView(){
    document.getElementById('cloudNormalView').classList.add('hidden');
    document.getElementById('cloudTrashView').classList.remove('hidden');
    loadTrashView();
  }

  function closeTrashView(){
    document.getElementById('cloudTrashView').classList.add('hidden');
    document.getElementById('cloudNormalView').classList.remove('hidden');
  }

  async function loadTrashView(){
    const { data, error } = await sb.from('cloud_files').select('*').eq('user_id', currentUser.id).eq('is_trashed', true).order('created_at', { ascending:false });
    if(error){ showToast('Could not load Trash'); return; }
    const grid = document.getElementById('cloudTrashGrid');
    const empty = document.getElementById('trashEmptyState');
    grid.innerHTML = '';
    (data || []).forEach(file => {
      const ext = getExt(file.file_name);
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="file-icon ${getTypeClass(ext)}">${getFileIcon(ext)}<span class="ext-ribbon">${ext}</span></div>
        <div class="name">${escapeHtml(file.file_name)}</div>
        <div class="size">${formatSize(file.file_size)}</div>
        <div style="display:flex; gap:6px; margin-top:10px;">
          <button class="btn btn-ghost" style="flex:1; justify-content:center; padding:6px; font-size:11.5px;" data-action="restore">Restore</button>
          <button class="btn" style="flex:1; justify-content:center; padding:6px; font-size:11.5px; background:var(--danger); color:#fff;" data-action="delete">Delete</button>
        </div>
      `;
      card.querySelector('[data-action="restore"]').onclick = (e) => { e.stopPropagation(); restoreFile(file.id); };
      card.querySelector('[data-action="delete"]').onclick = (e) => { e.stopPropagation(); permanentDeleteFile(file.id, file.file_path); };
      grid.appendChild(card);
    });
    empty.classList.toggle('hidden', data && data.length > 0);
  }

  async function restoreFile(id){
    const { error } = await sb.from('cloud_files').update({ is_trashed: false }).eq('id', id);
    if(error){ showToast('Could not restore'); return; }
    showToast('Restored');
    loadTrashView();
  }

  async function permanentDeleteFile(id, filePath){
    if(!(await showConfirm('This cannot be undone.', 'Delete permanently?'))) return;
    await sb.storage.from('cloud-files').remove([filePath]);
    const { error } = await sb.from('cloud_files').delete().eq('id', id);
    if(error){ showToast('Could not delete'); return; }
    loadTrashView();
    await calculateAndUpdateStorage();
  }

  async function emptyTrash(){
    const { data } = await sb.from('cloud_files').select('id, file_path').eq('user_id', currentUser.id).eq('is_trashed', true);
    if(!data || data.length === 0){ showToast('Trash is already empty'); return; }
    if(!(await showConfirm(data.length + ' file(s) will be permanently deleted.', 'Empty Trash?'))) return;
    const paths = data.map(f => f.file_path);
    await sb.storage.from('cloud-files').remove(paths);
    const { error } = await sb.from('cloud_files').delete().eq('user_id', currentUser.id).eq('is_trashed', true);
    if(error){ showToast('Could not empty Trash'); return; }
    showToast('Trash emptied');
    loadTrashView();
    await calculateAndUpdateStorage();
  }

  function setupCloudDropzone(){
    const zone = document.getElementById('cloudDropzone');
    ['dragover','dragenter'].forEach(evt => {
      zone.addEventListener(evt, (e) => { e.preventDefault(); zone.style.borderColor = 'var(--accent)'; zone.style.backgroundColor = 'var(--accent-soft)'; });
    });
    ['dragleave','drop'].forEach(evt => {
      zone.addEventListener(evt, (e) => { e.preventDefault(); zone.style.borderColor = ''; zone.style.backgroundColor = ''; });
    });
    zone.addEventListener('drop', (e) => {
      const files = Array.from(e.dataTransfer.files || []);
      if(files.length) uploadCloudFilesBatch(files);
    });

    document.addEventListener('paste', (e) => {
      if(TAB_ORDER[currentTabIndex] !== 'cloud') return;
      if(document.activeElement && ['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) return;
      const files = e.clipboardData && Array.from(e.clipboardData.files || []);
      if(files && files.length > 0){
        uploadCloudFilesBatch(files);
      }
    });
  }

  function isAnyModalOpen(){
    return !document.getElementById('settingsModal').classList.contains('hidden') ||
           !document.getElementById('confirmModal').classList.contains('hidden') ||
           !document.getElementById('promptModal').classList.contains('hidden') ||
           !document.getElementById('recoveryModal').classList.contains('hidden') ||
           !document.getElementById('changeUsernameModal').classList.contains('hidden') ||
           !document.getElementById('changePasscodeModal').classList.contains('hidden') ||
           !document.getElementById('lightboxModal').classList.contains('hidden') ||
           !document.getElementById('textPreviewModal').classList.contains('hidden');
  }

  function setupSwipeNavigation(){
    const zone = document.getElementById('panels');
    const track = document.getElementById('panelsTrack');
    let startX = 0, startY = 0, tracking = false, decided = false, isHorizontal = false;
    let startTime = 0;
    let viewportWidth = 0;

    function baseOffsetPercent(){ return -(currentTabIndex * 33.3333); }

    zone.addEventListener('touchstart', (e) => {
      if(isAnyModalOpen()){ tracking = false; return; }
      if(e.target.closest('.editor, input, textarea, .modal-overlay, .appearance-panel')) { tracking = false; return; }
      const t = e.touches[0];
      startX = t.clientX; startY = t.clientY;
      startTime = Date.now();
      viewportWidth = zone.clientWidth;
      tracking = true; decided = false; isHorizontal = false;
    }, { passive: true });

    zone.addEventListener('touchmove', (e) => {
      if(!tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);

      // Instant Intent Detection: 1 pixel threshold!
      if(!decided && (absX >= 1 || absY >= 1)){
        decided = true;
        isHorizontal = absX > absY;
        if(isHorizontal) track.classList.add('dragging');
      }
      if(!isHorizontal) return;

      if(e.cancelable) e.preventDefault();

      let effectiveDx = dx;
      if((currentTabIndex === 0 && dx > 0) || (currentTabIndex === TAB_ORDER.length - 1 && dx < 0)){
        effectiveDx = dx * 0.35;
      }
      const dragPercent = (effectiveDx / viewportWidth) * 33.3333;
      // CSS 3D Hardware Acceleration (translate3d)
      track.style.transform = `translate3d(${(baseOffsetPercent() + dragPercent)}%, 0, 0)`;
    }, { passive: false });

    zone.addEventListener('touchend', (e) => {
      if(!tracking){ return; }
      tracking = false;
      track.classList.remove('dragging');
      if(!isHorizontal){ return; }

      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const duration = Date.now() - startTime;
      const velocity = Math.abs(dx) / duration; // px per ms

      const THRESHOLD = viewportWidth * 0.15; // Balanced snap threshold
      const VELOCITY_THRESHOLD = 0.35; // px/ms threshold for fast flicks

      if((dx < -THRESHOLD || (velocity > VELOCITY_THRESHOLD && dx < -10)) && currentTabIndex < TAB_ORDER.length - 1){
        switchTab(TAB_ORDER[currentTabIndex + 1]);
      } else if((dx > THRESHOLD || (velocity > VELOCITY_THRESHOLD && dx > 10)) && currentTabIndex > 0){
        switchTab(TAB_ORDER[currentTabIndex - 1]);
      } else {
        track.style.transform = `translate3d(${baseOffsetPercent()}%, 0, 0)`;
      }
    });
  }

  setupScrollWatcher();
  setupPasteHandler();
  setupSwipeNavigation();
  setupCloudDropzone();

  function closeNote(){
    if(currentNoteId){ clearTimeout(noteSaveTimer); saveCurrentNote(); }
    currentNoteId = null;
    document.getElementById('notes-list').style.display = 'flex';
    document.querySelector('.fab').style.display = 'flex';
    document.getElementById('note-editor').classList.remove('active');
  }

  const THEME_NAMES = {
    '': 'Teal · Light',
    'teal-dark': 'Teal · Dark',
    'bw-light': 'B&W · Light',
    'bw-dark': 'B&W · Dark',
    'cream-light': 'Cream · Light'
  };

  function openSettings(){
    const active = document.documentElement.getAttribute('data-theme') || '';
    document.querySelectorAll('.theme-list-item').forEach(el => {
      el.classList.toggle('active', (el.dataset.theme || '') === active);
    });
    document.getElementById('settingsRowTheme').textContent = THEME_NAMES[active] || 'Teal · Light';
    document.getElementById('settingsRowUsername').textContent = currentUsername;
    document.getElementById('appearancePanel').classList.add('hidden');
    document.getElementById('appearanceChevron').classList.remove('rotated');
    document.getElementById('storagePanel').classList.add('hidden');
    document.getElementById('storageChevron').classList.remove('rotated');
    updateStorageBreakdownUI();
    document.getElementById('settingsModal').classList.remove('hidden');
    pushBackEntry(closeSettings);
  }
  function closeSettings(){
    document.getElementById('settingsModal').classList.add('hidden');
  }
  function toggleAppearancePanel(){
    document.getElementById('storagePanel').classList.add('hidden');
    document.getElementById('storageChevron').classList.remove('rotated');
    document.getElementById('appearancePanel').classList.toggle('hidden');
    document.getElementById('appearanceChevron').classList.toggle('rotated');
  }

  function toggleStoragePanel(){
    document.getElementById('appearancePanel').classList.add('hidden');
    document.getElementById('appearanceChevron').classList.remove('rotated');
    document.getElementById('storagePanel').classList.toggle('hidden');
    document.getElementById('storageChevron').classList.toggle('rotated');
  }

  async function exportBackup(){
    showToast('Preparing backup…');
    try{
      const [notesRes, vaultRes] = await Promise.all([
        sb.from('notes').select('*').eq('user_id', currentUser.id).order('created_at', { ascending:true }),
        sb.from('vault_items').select('*').eq('user_id', currentUser.id).eq('type', 'text').order('created_at', { ascending:true })
      ]);

      let out = 'DUCKLY BACKUP\n';
      out += 'Username: ' + currentUsername + '\n';
      out += 'Exported: ' + new Date().toLocaleString() + '\n';
      out += '(Text content only — files are not included in this export)\n';
      out += '\n' + '='.repeat(40) + '\nNOTES\n' + '='.repeat(40) + '\n\n';

      (notesRes.data || []).forEach(note => {
        out += '--- ' + (note.title || 'Untitled') + ' ---\n';
        out += 'Modified: ' + new Date(note.modified_at).toLocaleString() + '\n\n';
        out += (note.body || '') + '\n\n';
      });

      out += '\n' + '='.repeat(40) + '\nCHAT HISTORY\n' + '='.repeat(40) + '\n\n';
      (vaultRes.data || []).forEach(item => {
        out += '[' + new Date(item.created_at).toLocaleString() + '] ' + (item.content || '') + '\n';
      });

      const blob = new Blob([out], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'duckly-backup-' + Date.now() + '.txt';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      showToast('Backup downloaded');
    } catch(err){
      showToast('Could not create backup');
    }
  }

  async function handleClearChatHistory(){
    if(!(await showConfirm('All text messages will be permanently deleted. Files will NOT be affected.', 'Clear chat history?', 'Clear'))) return;
    const { error } = await sb.from('vault_items').delete().eq('user_id', currentUser.id).eq('type', 'text');
    if(error){ showToast('Could not clear history'); return; }
    showToast('Chat history cleared');
    await loadVaultItems();
  }

  function openChatOptionsMenu(anchorEl){
    closeBubbleDropdown();
    const rect = anchorEl.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'bubble-dropdown';
    menu.innerHTML = '<button data-act="clear" class="danger">Clear Chat History</button>';
    document.body.appendChild(menu);

    const menuWidth = menu.offsetWidth;
    let left = rect.right - menuWidth;
    if(left < 8) left = 8;
    menu.style.top = (rect.bottom + 6 + window.scrollY) + 'px';
    menu.style.left = left + 'px';

    menu.querySelector('[data-act="clear"]').onclick = () => {
      closeBubbleDropdown();
      handleClearChatHistory();
    };

    _openDropdown = menu;
    setTimeout(() => document.addEventListener('click', closeBubbleDropdownOnOutsideClick, true), 0);
  }

  function openAttachMenu(anchorEl){
    closeBubbleDropdown();
    const rect = anchorEl.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'attach-menu';
    menu.innerHTML = `
      <button data-act="gallery">
        <span class="attach-menu-icon" style="background:var(--accent-soft); color:var(--accent);">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
        </span>
        Gallery
      </button>
      <button data-act="camera">
        <span class="attach-menu-icon" style="background:#FDE7F0; color:#D6417A;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z"/><circle cx="12" cy="13" r="4"/></svg>
        </span>
        Camera
      </button>
      <button data-act="document">
        <span class="attach-menu-icon" style="background:#E3EEFC; color:#2F6FE4;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
        </span>
        Document
      </button>
    `;
    document.body.appendChild(menu);

    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    let left = rect.left;
    if(left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
    if(left < 8) left = 8;
    menu.style.left = left + 'px';
    menu.style.top = (rect.top + window.scrollY - menuHeight - 8) + 'px';

    menu.querySelector('[data-act="gallery"]').onclick = () => { closeBubbleDropdown(); document.getElementById('galleryInput').click(); };
    menu.querySelector('[data-act="camera"]').onclick = () => { closeBubbleDropdown(); document.getElementById('cameraInput').click(); };
    menu.querySelector('[data-act="document"]').onclick = () => { closeBubbleDropdown(); document.getElementById('fileInput').click(); };

    _openDropdown = menu;
    setTimeout(() => document.addEventListener('click', closeBubbleDropdownOnOutsideClick, true), 0);
  }


  function applyTheme(themeName, syncToSupabase, itemEl){
    if(themeName){
      document.documentElement.setAttribute('data-theme', themeName);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    try{ localStorage.setItem('duckly-theme', themeName); }catch(e){}

    document.querySelectorAll('.theme-list-item').forEach(el => el.classList.remove('active'));
    if(!itemEl){
      itemEl = document.querySelector('.theme-list-item[data-theme="' + themeName + '"]');
    }
    if(itemEl) itemEl.classList.add('active');

    const rowLabel = document.getElementById('settingsRowTheme');
    if(rowLabel) rowLabel.textContent = THEME_NAMES[themeName] || 'Teal · Light';

    if(syncToSupabase && currentUser){
      sb.from('profiles').update({ theme: themeName }).eq('id', currentUser.id)
        .then(({ error }) => { if(error) showToast('Could not sync theme'); });
    }
  }

  function setTheme(themeName, itemEl){
    applyTheme(themeName, true, itemEl);
  }

  /* ================= Themed dialogs integrated with back-stack ================= */
  let _confirmResolve = null;
  let _confirmResult = false;
  
  function showConfirm(message, title, okLabel){
    return new Promise((resolve) => {
      document.getElementById('confirmTitle').textContent = title || 'Delete this?';
      document.getElementById('confirmMessage').textContent = message || 'This action cannot be undone.';
      const okBtn = document.getElementById('confirmOkBtn');
      okBtn.textContent = okLabel || 'Delete';
      okBtn.style.background = (okLabel && okLabel !== 'Delete') ? 'var(--accent)' : 'var(--danger)';
      document.getElementById('confirmModal').classList.remove('hidden');
      _confirmResolve = resolve;
      _confirmResult = false;
      pushBackEntry(closeConfirmModal);
    });
  }

  function closeConfirmModal(){
    document.getElementById('confirmModal').classList.add('hidden');
    if(_confirmResolve){
      _confirmResolve(_confirmResult);
      _confirmResolve = null;
    }
  }

  document.getElementById('confirmOkBtn').addEventListener('click', () => {
    _confirmResult = true;
    dismissTop();
  });
  document.getElementById('confirmCancelBtn').addEventListener('click', () => {
    _confirmResult = false;
    dismissTop();
  });

  let _promptResolve = null;
  let _promptResult = null;

  function showPrompt(title, placeholder){
    return new Promise((resolve) => {
      document.getElementById('promptTitle').textContent = title || 'Enter a name';
      const input = document.getElementById('promptInput');
      input.placeholder = placeholder || '';
      input.value = '';
      document.getElementById('promptModal').classList.remove('hidden');
      _promptResolve = resolve;
      _promptResult = null;
      pushBackEntry(closePromptModal);
      setTimeout(() => input.focus(), 50);
    });
  }

  function closePromptModal(){
    document.getElementById('promptModal').classList.add('hidden');
    if(_promptResolve){
      _promptResolve(_promptResult);
      _promptResolve = null;
    }
  }

  document.getElementById('promptOkBtn').addEventListener('click', () => {
    _promptResult = document.getElementById('promptInput').value.trim() || null;
    dismissTop();
  });
  document.getElementById('promptCancelBtn').addEventListener('click', () => {
    _promptResult = null;
    dismissTop();
  });
  document.getElementById('promptInput').addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){
      _promptResult = document.getElementById('promptInput').value.trim() || null;
      dismissTop();
    }
  });

  /* ================= Bubble Action Mechanics ================= */
  let _confirmOpenedAt = 0;
  document.getElementById('confirmModal').addEventListener('click', (e) => {
    if(Date.now() - _confirmOpenedAt < 350){
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  /* ================= Multi-select mode (Chat / Notes / My Cloud) ================= */
  let selectionMode = false;
  let selectionModule = null; // 'chat' | 'notes' | 'cloud'
  let selectedItems = new Map(); // id -> ctx { module, type, id, wrap, filePath, fileSize, filename }

  const SELECTION_CONTAINER_ID = { chat: 'chat-scroll', notes: 'notes-list', cloud: 'cloudFilesGrid' };
  const SELECTION_CLASS = { chat: 'bubble-selected', notes: 'note-selected', cloud: 'card-selected' };

  function enterSelectionMode(ctx){
    selectionMode = true;
    selectionModule = ctx.module;
    document.getElementById('normalTopbarRow').classList.add('hidden');
    document.getElementById('selectionTopbarRow').classList.remove('hidden');
    document.getElementById('selectionDownloadBtn').classList.toggle('hidden', ctx.module !== 'cloud');
    const containerId = SELECTION_CONTAINER_ID[ctx.module];
    if(containerId){
      const el = document.getElementById(containerId);
      if(el) el.classList.add('selection-active');
    }
    toggleSelectItem(ctx);
  }

  function exitSelectionMode(){
    selectionMode = false;
    selectedItems.forEach(ctx => ctx.wrap.classList.remove(SELECTION_CLASS[ctx.module]));
    selectedItems.clear();
    if(selectionModule){
      const containerId = SELECTION_CONTAINER_ID[selectionModule];
      if(containerId){
        const el = document.getElementById(containerId);
        if(el) el.classList.remove('selection-active');
      }
    }
    selectionModule = null;
    document.getElementById('selectionTopbarRow').classList.add('hidden');
    document.getElementById('normalTopbarRow').classList.remove('hidden');
  }

  function toggleSelectItem(ctx){
    const selClass = SELECTION_CLASS[ctx.module];
    if(selectedItems.has(ctx.id)){
      selectedItems.delete(ctx.id);
      ctx.wrap.classList.remove(selClass);
    } else {
      selectedItems.set(ctx.id, ctx);
      ctx.wrap.classList.add(selClass);
    }
    if(selectedItems.size === 0){ exitSelectionMode(); return; }
    document.getElementById('selectionCountLabel').textContent = selectedItems.size + ' selected';
  }

  async function deleteSelectedItems(){
    const items = Array.from(selectedItems.values());
    if(!items.length) return;
    _confirmOpenedAt = Date.now();
    if(!(await showConfirm(`This will permanently delete ${items.length} item(s).`, 'Delete selected?'))) return;

    if(selectionModule === 'chat'){
      for(const ctx of items){
        if(ctx.type === 'text'){ await deleteVaultItem(ctx.id, ctx.wrap); }
        else { await deleteVaultItem(ctx.id, ctx.wrap, ctx.filePath, ctx.fileSize); }
      }
    } else if(selectionModule === 'notes'){
      const ids = items.map(i => i.id);
      const { error } = await sb.from('notes').delete().in('id', ids);
      if(error){ showToast('Could not delete notes'); }
      notesCache = notesCache.filter(n => !ids.includes(n.id));
      renderNotesList();
    } else if(selectionModule === 'cloud'){
      for(const ctx of items){
        await sb.from('cloud_files').update({ is_trashed: true }).eq('id', ctx.id);
      }
      loadCloudView();
    }
    showToast(items.length + ' item(s) deleted');
    exitSelectionMode();
  }

  async function downloadSelectedItems(){
    if(selectionModule !== 'cloud') return;
    const items = Array.from(selectedItems.values());
    if(!items.length) return;
    let count = 0;
    for(const ctx of items){
      count++;
      showToast(`Downloading ${count}/${items.length}…`);
      await downloadFile('cloud-files', ctx.filePath, ctx.filename, { innerHTML:'', disabled:false });
    }
    showToast(`Downloaded ${count} file(s)`);
    exitSelectionMode();
  }

  function attachLongPressActions(el, contextFn){
    let pressTimer = null;
    let firedByLongPress = false;

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const ctx = contextFn();
      if(!selectionMode){ enterSelectionMode(ctx); } else { toggleSelectItem(ctx); }
    });

    el.addEventListener('touchstart', () => {
      firedByLongPress = false;
      pressTimer = setTimeout(() => {
        firedByLongPress = true;
        const ctx = contextFn();
        if(!selectionMode){ enterSelectionMode(ctx); } else { toggleSelectItem(ctx); }
      }, 480);
    }, { passive:true });
    el.addEventListener('touchend', () => clearTimeout(pressTimer));
    el.addEventListener('touchmove', () => clearTimeout(pressTimer));

    // Capture-phase click: while in selection mode, taps toggle selection instead of
    // the bubble's normal action (download/preview/copy). Also swallows the synthetic
    // click that follows a long-press on touch devices, so it doesn't double-toggle.
    el.addEventListener('click', (e) => {
      if(firedByLongPress){ firedByLongPress = false; e.stopImmediatePropagation(); e.preventDefault(); return; }
      if(selectionMode){
        e.stopImmediatePropagation();
        e.preventDefault();
        toggleSelectItem(contextFn());
      }
    }, true);
  }

  /* ================= Desktop Hover Menus & Clipboard copy ================= */
  let _openDropdown = null;

  function closeBubbleDropdown(){
    if(_openDropdown){ _openDropdown.remove(); _openDropdown = null; }
    document.removeEventListener('click', closeBubbleDropdownOnOutsideClick, true);
  }

  function closeBubbleDropdownOnOutsideClick(e){
    if(_openDropdown && !_openDropdown.contains(e.target)){
      closeBubbleDropdown();
    }
  }

  function openBubbleDropdown(anchorEl, contextFn){
    closeBubbleDropdown();
    const ctx = contextFn();
    const rect = anchorEl.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'bubble-dropdown';
    let html = '';
    if(ctx.type === 'text'){
      html += '<button data-act="copy">Copy</button>';
    }
    html += '<button data-act="select">Select</button>';
    html += '<button data-act="delete" class="danger">Delete</button>';
    menu.innerHTML = html;
    document.body.appendChild(menu);

    const menuWidth = menu.offsetWidth;
    let left = rect.right - menuWidth;
    if(left < 8) left = 8;
    menu.style.top = (rect.bottom + 6 + window.scrollY) + 'px';
    menu.style.left = left + 'px';

    menu.querySelector('[data-act="delete"]').onclick = async () => {
      closeBubbleDropdown();
      _confirmOpenedAt = Date.now();
      if(!(await showConfirm('This will be permanently deleted.', 'Delete this?'))) return;
      if(ctx.type === 'text'){
        await deleteVaultItem(ctx.id, ctx.wrap);
      } else {
        await deleteVaultItem(ctx.id, ctx.wrap, ctx.filePath, ctx.fileSize);
      }
    };
    const copyBtn = menu.querySelector('[data-act="copy"]');
    if(copyBtn){
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(ctx.text || '').catch(()=>{});
        showToast('Copied');
        closeBubbleDropdown();
      };
    }
    menu.querySelector('[data-act="select"]').onclick = () => {
      closeBubbleDropdown();
      if(!selectionMode){ enterSelectionMode(ctx); } else { toggleSelectItem(ctx); }
    };

    _openDropdown = menu;
    setTimeout(() => document.addEventListener('click', closeBubbleDropdownOnOutsideClick, true), 0);
  }

  function attachChevron(chevronEl, contextFn){
    chevronEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHoverCapable = window.matchMedia('(hover: hover)').matches;
      if(isHoverCapable){
        openBubbleDropdown(chevronEl, contextFn);
      } else {
        const ctx = contextFn();
        navigator.clipboard.writeText(ctx.text || '').catch(()=>{});
        showToast('Copied');
      }
    });
  }

  /* ================= PWA Setup ================= */
  let deferredInstallPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
  });

  function isStandaloneMode(){
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function isIOSDevice(){
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  function checkAndShowInstallBanner(){
    if(isStandaloneMode()) return;
    try{
      const dismissedAt = localStorage.getItem('duckly-install-dismissed');
      if(dismissedAt && (Date.now() - parseInt(dismissedAt, 10)) < 7 * 24 * 60 * 60 * 1000) return;
    }catch(e){}

    const banner = document.getElementById('installBanner');
    const sub = document.getElementById('installSub');
    const btn = document.getElementById('installBtn');

    if(deferredInstallPrompt){
      sub.textContent = 'Add to your home screen for quick access';
      btn.classList.remove('hidden');
      banner.classList.remove('hidden');
    } else if(isIOSDevice()){
      sub.textContent = 'Tap Share, then "Add to Home Screen"';
      btn.classList.add('hidden');
      banner.classList.remove('hidden');
    }
  }

  async function triggerInstall(){
    if(!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    document.getElementById('installBanner').classList.add('hidden');
  }

  function dismissInstallBanner(){
    document.getElementById('installBanner').classList.add('hidden');
    try{ localStorage.setItem('duckly-install-dismissed', Date.now().toString()); }catch(e){}
  }
/* ================= DESKTOP KEYBOARD SHORTCUTS ================= */
  document.addEventListener('keydown', (e) => {
    // Esc Key Handling
    if (e.key === 'Escape') {
      closeBubbleDropdown();
      if (!document.getElementById('confirmModal').classList.contains('hidden')) { 
          _confirmResult = false; dismissTop(); return; 
      }
      if (!document.getElementById('promptModal').classList.contains('hidden')) { 
          _promptResult = null; dismissTop(); return; 
      }
      if (backStack.length > 0) { dismissTop(); return; }
    }

    // Input/Textarea focus check (Enter ছাড়া অন্য শর্টকাট ইনপুটে কাজ করবে না)
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && e.key !== 'Enter') return;

    // Shortcuts
    if (e.key === '/') { e.preventDefault(); document.getElementById('chat-input').focus(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newNote(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'u') { e.preventDefault(); document.getElementById('cloudFileInput').click(); }
    if (e.key === 'Backspace' && TAB_ORDER[currentTabIndex] === 'cloud' && cloudCurrentFolderId !== null) {
      e.preventDefault();
      navigateCloudBack();
    }
  });