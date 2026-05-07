/* =========================================================================
   Flow Finder v6 — winwithflynn.com/flow-finder
   Vanilla JavaScript. No framework. No CDN dependencies (audio is embedded).
   --------------------------------------------------------------------------
   What's new in v6:
     • Drift-free timer — works from background tabs
     • Reliable bell — primed audio + system notifications
     • Tab title countdown
     • Click-to-toggle info popover (was hover, broken on touch)
     • Single-source-of-truth Idle/Active label
     • Task list with session estimates and persistence
     • Sound picker (4 sounds + Cornelius the Cowbell easter egg)
     • Mode-aware break coaching tips
     • Daily session counter
     • All preferences saved to localStorage
   ========================================================================= */

(function () {
  'use strict';

  // -------------------------------------------------------------------------
  // CONSTANTS
  // -------------------------------------------------------------------------

  const FLOW_MODES = {
    classic: {
      id: 'classic',
      label: 'Classic Pomodoro',
      short: '25 / 5',
      work: 25,
      break: 17 && 5,
      desc: 'Beat procrastination. Build the focus habit.',
      science: 'Francesco Cirillo, late 1980s. Backed by a 2023 Maastricht study showing higher concentration and lower fatigue vs. self-paced breaks.',
      best: 'Beginners. High-distraction days. Tired mornings.',
    },
    balanced: {
      id: 'balanced',
      label: 'Balanced 52/17',
      short: '52 / 17',
      work: 52,
      break: 17,
      desc: 'Sustained focus. Real recovery.',
      science: 'DeskTime studied their top 10% of users in 2014 and found a 52-minute work / 17-minute break pattern. Featured in Inc. and Fast Company.',
      best: 'Knowledge work. Writing. Anyone who has outgrown 25-minute blocks.',
    },
    ultradian: {
      id: 'ultradian',
      label: 'Deep Flow 90',
      short: '90 / 20',
      work: 90,
      break: 20,
      desc: 'Where the magic happens.',
      science: 'Sleep researcher Nathaniel Kleitman found the body runs on 90-minute ultradian cycles. Anders Ericsson found elite violinists practiced in 90-minute blocks.',
      best: 'Deep work. Complex problem-solving. Strategic thinking. Coding.',
    },
    extended: {
      id: 'extended',
      label: 'Extended Flow',
      short: '120 / 30',
      work: 120,
      break: 30,
      desc: 'Monk mode. Use sparingly.',
      science: 'The upper edge of the ultradian rhythm. Cal Newport suggests even experienced deep workers max out at ~4 hours per day.',
      best: 'Thesis writing. Intensive research. Not for beginners.',
    },
    custom: {
      id: 'custom',
      label: 'Custom',
      short: '',
      work: 45,
      break: 10,
      desc: 'Your rhythm, your call.',
      science: 'No universal "perfect" ratio exists. DeskTime\'s own optimum has shifted from 52/17 to 75/33 over the years. Find yours.',
      best: 'Once you know your own focus capacity.',
    },
  };

  // Fix the typo above (intentional reminder this is a fresh build)
  FLOW_MODES.classic.break = 5;

  const SOUNDS = {
    bell: {
      label: 'Soft Bell',
      desc: 'Default. Calm and clear.',
    },
    chime: {
      label: 'Chime',
      desc: 'Gentle three-tone.',
    },
    ding: {
      label: 'Kitchen Ding',
      desc: 'Classic timer.',
    },
    digital: {
      label: 'Digital',
      desc: 'Crisp and modern.',
    },
    cornelius: {
      label: 'Cornelius the Cowbell',
      desc: 'More cowbell. Always more cowbell.',
    },
  };

  // Mode-aware break coaching tips (rotates each break)
  const BREAK_TIPS = {
    classic: [
      'Stand up. Even just for a moment.',
      'Look at something 20 feet away to rest your eyes.',
      'Don\'t check email on this break — that\'s not rest.',
      'A 5-minute walk beats 5 minutes of scrolling, every time.',
      'Hydrate. Most "tired" is actually thirsty.',
    ],
    balanced: [
      'DeskTime\'s research found the top performers fully disconnected on breaks. No Slack. No email.',
      '17 minutes is enough for a real walk. Take it outside if you can.',
      'You earned this break. Don\'t cut it short to seem productive.',
      'Movement is the fastest reset. Stretch, walk, anything.',
      'Resist the urge to "just check one thing." That breaks the recovery.',
    ],
    ultradian: [
      'You just completed an ultradian cycle. 20 minutes is the minimum recovery — take it.',
      'This is the break that matters. Walk. Breathe. Get away from the screen.',
      'Your brain is consolidating what you just learned. Let it.',
      'Fresh air, even for 5 of these 20 minutes, will sharpen the next session.',
      'Anders Ericsson\'s elite performers built recovery into their schedules. So can you.',
    ],
    extended: [
      'You went deep. Now go fully away. 30 minutes, no shortcuts.',
      'Eat. Move. Step outside. This break decides the quality of your next session.',
      'Cal Newport caps deep work at 4 hours a day for a reason. Respect the recovery.',
      'Don\'t open the laptop. Don\'t check the phone. Actually rest.',
      'A real break makes the next 120 minutes possible. A fake one makes them garbage.',
    ],
    custom: [
      'Whatever break length you picked — actually take it.',
      'A real break means no email, no Slack, no "quick" tasks.',
      'Track how you feel coming back. That\'s how you find your rhythm.',
      'Movement, hydration, fresh air. The boring stuff works.',
      'You\'re experimenting. Notice what helps and what doesn\'t.',
    ],
  };

  const STORAGE_KEY = 'flowfinder.v6';

  const DEFAULTS = {
    modeId: 'classic',
    customWork: 45,
    customBreak: 10,
    soundId: 'bell',
    volume: 0.6,
    notifications: false, // user grants permission later
    autoStart: false,
    tasks: [],
    activeTaskId: null,
    today: { date: '', sessions: 0, focusedMinutes: 0 },
  };

  // -------------------------------------------------------------------------
  // STATE
  // -------------------------------------------------------------------------

  let state = loadState();

  // Runtime-only (not persisted)
  let phase = 'work';            // 'work' | 'break'
  let isRunning = false;
  let endTime = null;            // ms timestamp when current session ends
  let remainingMs = modeMins(phase) * 60 * 1000;
  let tickRaf = null;
  let endTimeoutId = null;
  let currentBreakTip = '';

  // Audio elements (primed on first user gesture)
  const audioElements = {};
  let audioPrimed = false;

  // -------------------------------------------------------------------------
  // STORAGE
  // -------------------------------------------------------------------------

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(DEFAULTS);
      const parsed = JSON.parse(raw);
      const merged = { ...structuredClone(DEFAULTS), ...parsed };
      // Reset today's count if it's a new day
      const today = todayString();
      if (merged.today.date !== today) {
        merged.today = { date: today, sessions: 0, focusedMinutes: 0 };
      }
      return merged;
    } catch (e) {
      return structuredClone(DEFAULTS);
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // Storage full or blocked — fail silently
    }
  }

  function todayString() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  // -------------------------------------------------------------------------
  // TIMER ENGINE
  // -------------------------------------------------------------------------

  function modeMins(p) {
    const m = FLOW_MODES[state.modeId];
    if (state.modeId === 'custom') {
      return p === 'work' ? state.customWork : state.customBreak;
    }
    return p === 'work' ? m.work : m.break;
  }

  function startTimer() {
    primeAudio(); // user gesture — unlock audio for later background plays
    requestNotificationPermission();

    isRunning = true;
    endTime = Date.now() + remainingMs;

    // Schedule the completion callback at the exact end time.
    // setTimeout fires reliably from background tabs (unlike setInterval ticks).
    if (endTimeoutId) clearTimeout(endTimeoutId);
    endTimeoutId = setTimeout(handleComplete, remainingMs);

    startTicking();
    render();
  }

  function pauseTimer() {
    isRunning = false;
    remainingMs = Math.max(0, endTime - Date.now());
    endTime = null;
    if (endTimeoutId) { clearTimeout(endTimeoutId); endTimeoutId = null; }
    stopTicking();
    render();
  }

  function resetTimer() {
    isRunning = false;
    endTime = null;
    if (endTimeoutId) { clearTimeout(endTimeoutId); endTimeoutId = null; }
    stopTicking();
    remainingMs = modeMins(phase) * 60 * 1000;
    render();
  }

  function skipPhase() {
    // Skip to break or back to work without playing sound or counting
    if (endTimeoutId) { clearTimeout(endTimeoutId); endTimeoutId = null; }
    isRunning = false;
    endTime = null;
    stopTicking();

    if (phase === 'work') {
      phase = 'break';
      pickBreakTip();
    } else {
      phase = 'work';
    }
    remainingMs = modeMins(phase) * 60 * 1000;
    render();
  }

  function setMode(modeId) {
    if (!FLOW_MODES[modeId]) return;
    state.modeId = modeId;
    saveState();
    if (isRunning) pauseTimer();
    phase = 'work';
    remainingMs = modeMins(phase) * 60 * 1000;
    render();
  }

  function startTicking() {
    if (tickRaf) cancelAnimationFrame(tickRaf);
    const tick = () => {
      if (!isRunning) return;
      render(true); // tick-only render
      tickRaf = requestAnimationFrame(tick);
    };
    tickRaf = requestAnimationFrame(tick);
  }

  function stopTicking() {
    if (tickRaf) cancelAnimationFrame(tickRaf);
    tickRaf = null;
  }

  function handleComplete() {
    isRunning = false;
    endTime = null;
    stopTicking();

    playSound();
    fireNotification();

    if (phase === 'work') {
      // Count the session
      const minutes = modeMins('work');
      state.today.sessions += 1;
      state.today.focusedMinutes += minutes;
      // Increment task counter if active task
      if (state.activeTaskId) {
        const task = state.tasks.find(t => t.id === state.activeTaskId);
        if (task) {
          task.done = (task.done || 0) + 1;
          if (task.estimate && task.done >= task.estimate) {
            task.completed = true;
          }
        }
      }
      saveState();
      phase = 'break';
      pickBreakTip();
    } else {
      phase = 'work';
    }
    remainingMs = modeMins(phase) * 60 * 1000;
    render();
  }

  // Resync when tab becomes visible again — endTime math is the source of truth
  document.addEventListener('visibilitychange', () => {
    if (!isRunning || !endTime) return;
    const now = Date.now();
    if (now >= endTime) {
      // The setTimeout already fired (or should have); ensure completion ran
      if (endTimeoutId) { clearTimeout(endTimeoutId); endTimeoutId = null; }
      handleComplete();
    } else {
      remainingMs = endTime - now;
      render();
    }
  });

  function pickBreakTip() {
    const pool = BREAK_TIPS[state.modeId] || BREAK_TIPS.classic;
    currentBreakTip = pool[Math.floor(Math.random() * pool.length)];
  }

  // -------------------------------------------------------------------------
  // AUDIO
  // -------------------------------------------------------------------------

  // Programmatic WAV generation — embeds tones as data URIs so we have zero
  // network dependency and the bell rings reliably from background tabs.

  function generateWav(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
    // Convert to base64 data URI
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return 'data:audio/wav;base64,' + btoa(binary);
  }

  function buildSounds() {
    const SR = 22050;

    // Soft bell — single decaying sine at 880Hz with a softer overtone at 1760
    const bell = (() => {
      const dur = 1.4;
      const N = Math.floor(SR * dur);
      const arr = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const t = i / SR;
        const env = Math.exp(-3 * t);
        arr[i] = (Math.sin(2 * Math.PI * 880 * t) * 0.6 + Math.sin(2 * Math.PI * 1760 * t) * 0.25) * env;
      }
      return generateWav(arr, SR);
    })();

    // Chime — three ascending tones
    const chime = (() => {
      const dur = 1.6;
      const N = Math.floor(SR * dur);
      const arr = new Float32Array(N);
      const freqs = [523.25, 659.25, 783.99]; // C5, E5, G5
      for (let i = 0; i < N; i++) {
        const t = i / SR;
        const idx = Math.min(2, Math.floor(t / 0.4));
        const localT = t - idx * 0.4;
        const env = Math.exp(-4 * localT);
        arr[i] = Math.sin(2 * Math.PI * freqs[idx] * localT) * env * 0.5;
      }
      return generateWav(arr, SR);
    })();

    // Kitchen ding — bright high tone, short
    const ding = (() => {
      const dur = 1.0;
      const N = Math.floor(SR * dur);
      const arr = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const t = i / SR;
        const env = Math.exp(-5 * t);
        arr[i] = Math.sin(2 * Math.PI * 1318.5 * t) * env * 0.55; // E6
      }
      return generateWav(arr, SR);
    })();

    // Digital — three short beeps
    const digital = (() => {
      const dur = 0.9;
      const N = Math.floor(SR * dur);
      const arr = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const t = i / SR;
        const slot = Math.floor(t / 0.18);
        const inSlot = t - slot * 0.18;
        if (slot < 3 && inSlot < 0.1) {
          arr[i] = Math.sin(2 * Math.PI * 1000 * inSlot) * 0.5;
        }
      }
      return generateWav(arr, SR);
    })();

    // Cornelius — the cowbell. A bright, slightly detuned, woody clang.
    // We approximate a cowbell with two close metallic frequencies + noise burst.
    const cornelius = (() => {
      const dur = 0.6;
      const N = Math.floor(SR * dur);
      const arr = new Float32Array(N);
      // Two strikes for "cow-bell"
      for (let strike = 0; strike < 2; strike++) {
        const offset = Math.floor(strike * 0.22 * SR);
        for (let i = 0; i < SR * 0.35 && offset + i < N; i++) {
          const t = i / SR;
          const env = Math.exp(-12 * t);
          // Cowbell-ish: 800Hz + 540Hz with noise
          const tone = Math.sin(2 * Math.PI * 800 * t) * 0.4
                     + Math.sin(2 * Math.PI * 540 * t) * 0.4
                     + (Math.random() * 2 - 1) * 0.15 * Math.exp(-30 * t);
          arr[offset + i] += tone * env * 0.6;
        }
      }
      return generateWav(arr, SR);
    })();

    return { bell, chime, ding, digital, cornelius };
  }

  function setupAudio() {
    const sources = buildSounds();
    Object.keys(SOUNDS).forEach(id => {
      const a = new Audio(sources[id]);
      a.preload = 'auto';
      a.volume = state.volume;
      audioElements[id] = a;
    });
  }

  function primeAudio() {
    if (audioPrimed) return;
    Object.values(audioElements).forEach(a => {
      // Silent prime — required by browser autoplay policy so we can play later from background
      a.muted = true;
      a.play().then(() => {
        a.pause();
        a.currentTime = 0;
        a.muted = false;
      }).catch(() => {});
    });
    audioPrimed = true;
  }

  function playSound() {
    const a = audioElements[state.soundId];
    if (!a) return;
    a.volume = state.volume;
    a.currentTime = 0;
    a.play().catch(() => {});
  }

  function previewSound(id) {
    const a = audioElements[id];
    if (!a) return;
    a.volume = state.volume;
    a.currentTime = 0;
    a.play().catch(() => {});
  }

  // -------------------------------------------------------------------------
  // NOTIFICATIONS
  // -------------------------------------------------------------------------

  function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(p => {
        state.notifications = (p === 'granted');
        saveState();
      });
    } else {
      state.notifications = (Notification.permission === 'granted');
    }
  }

  function fireNotification() {
    if (!state.notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
    const justFinished = phase === 'break' ? 'work' : 'break'; // phase already advanced
    const title = justFinished === 'work'
      ? 'Focus complete'
      : 'Break over';
    const body = justFinished === 'work'
      ? `Time for a ${modeMins('break')}-minute break.`
      : 'Ready to get back in the flow?';
    try {
      new Notification(title, {
        body,
        tag: 'flow-finder',
        icon: 'https://winwithflynn.com/wp-content/uploads/2025/06/cropped-siteicon.jpeg',
      });
    } catch (e) {}
  }

  // -------------------------------------------------------------------------
  // TASK LIST
  // -------------------------------------------------------------------------

  function addTask(text, estimate) {
    if (!text.trim()) return;
    const task = {
      id: 't_' + Math.random().toString(36).slice(2, 9),
      text: text.trim(),
      estimate: estimate || null,
      done: 0,
      completed: false,
    };
    state.tasks.push(task);
    if (!state.activeTaskId) state.activeTaskId = task.id;
    saveState();
    render();
  }

  function deleteTask(id) {
    state.tasks = state.tasks.filter(t => t.id !== id);
    if (state.activeTaskId === id) {
      const next = state.tasks.find(t => !t.completed);
      state.activeTaskId = next ? next.id : null;
    }
    saveState();
    render();
  }

  function toggleTaskComplete(id) {
    const t = state.tasks.find(t => t.id === id);
    if (!t) return;
    t.completed = !t.completed;
    if (t.completed && state.activeTaskId === id) {
      const next = state.tasks.find(x => !x.completed);
      state.activeTaskId = next ? next.id : null;
    }
    saveState();
    render();
  }

  function setActiveTask(id) {
    state.activeTaskId = id;
    saveState();
    render();
  }

  function clearCompletedTasks() {
    state.tasks = state.tasks.filter(t => !t.completed);
    saveState();
    render();
  }

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------

  const root = document.getElementById('flow-finder-root');
  if (!root) {
    console.error('Flow Finder: #flow-finder-root not found.');
    return;
  }

  function buildScaffold() {
    root.innerHTML = `
      <div class="ff" data-phase="work" data-running="false">
        <header class="ff-header">
          <div class="ff-modes" role="tablist" aria-label="Flow modes"></div>
        </header>

        <main class="ff-stage">
          <div class="ff-phase-label" aria-live="polite">
            <span class="ff-status-dot"></span>
            <span class="ff-phase-text">Focus</span>
            <button class="ff-info-btn" type="button" aria-label="About this mode" aria-expanded="false">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>
            </button>
            <div class="ff-info-popover" role="dialog" hidden></div>
          </div>

          <div class="ff-time" aria-live="off">
            <div class="ff-progress-ring">
              <svg viewBox="0 0 200 200">
                <circle class="ff-progress-track" cx="100" cy="100" r="92"></circle>
                <circle class="ff-progress-bar" cx="100" cy="100" r="92"></circle>
              </svg>
            </div>
            <div class="ff-time-display">
              <span class="ff-mins">25</span><span class="ff-colon">:</span><span class="ff-secs">00</span>
            </div>
          </div>

          <div class="ff-controls">
            <button class="ff-btn ff-btn-primary" type="button" data-action="toggle">Start</button>
            <button class="ff-btn ff-btn-ghost" type="button" data-action="reset" aria-label="Reset timer">Reset</button>
            <button class="ff-btn ff-btn-ghost" type="button" data-action="skip" aria-label="Skip to next phase">Skip</button>
          </div>

          <div class="ff-tip" hidden></div>

          <div class="ff-today">
            <span class="ff-today-count">0</span> sessions today
            <span class="ff-today-sep">·</span>
            <span class="ff-today-mins">0</span> minutes focused
          </div>
        </main>

        <section class="ff-tasks">
          <div class="ff-tasks-head">
            <h3>Today's tasks</h3>
            <button class="ff-link" type="button" data-action="clear-completed">Clear completed</button>
          </div>
          <div class="ff-task-list" role="list"></div>
          <form class="ff-task-form" autocomplete="off">
            <input class="ff-task-input" type="text" placeholder="What are you working on?" maxlength="120" />
            <input class="ff-task-est" type="number" min="1" max="20" placeholder="Sessions" aria-label="Estimated sessions" />
            <button class="ff-btn ff-btn-secondary" type="submit">Add</button>
          </form>
        </section>

        <footer class="ff-footer">
          <button class="ff-link" type="button" data-action="open-settings">Settings &amp; Sound</button>
        </footer>

        <div class="ff-modal" data-modal="settings" hidden>
          <div class="ff-modal-backdrop"></div>
          <div class="ff-modal-card" role="dialog" aria-modal="true" aria-labelledby="ff-settings-title">
            <button class="ff-modal-close" type="button" aria-label="Close">×</button>
            <h2 id="ff-settings-title">Settings</h2>

            <div class="ff-setting-group">
              <label class="ff-setting-label">Alarm sound</label>
              <div class="ff-sound-grid"></div>
            </div>

            <div class="ff-setting-group">
              <label class="ff-setting-label" for="ff-volume">Volume</label>
              <input class="ff-volume" id="ff-volume" type="range" min="0" max="1" step="0.05" />
            </div>

            <div class="ff-setting-group" data-custom-only hidden>
              <label class="ff-setting-label">Custom timer</label>
              <div class="ff-custom-row">
                <label>Work
                  <input class="ff-custom-work" type="number" min="1" max="240" />
                  <span>min</span>
                </label>
                <label>Break
                  <input class="ff-custom-break" type="number" min="1" max="60" />
                  <span>min</span>
                </label>
              </div>
            </div>

            <div class="ff-setting-group">
              <label class="ff-setting-label">Notifications</label>
              <p class="ff-setting-desc">
                Get a system alert when a session ends — even when this tab is in the background.
              </p>
              <button class="ff-btn ff-btn-secondary" type="button" data-action="enable-notifications">
                Enable browser notifications
              </button>
              <span class="ff-notif-status"></span>
            </div>

            <div class="ff-setting-group">
              <label class="ff-setting-label">Reset</label>
              <button class="ff-btn ff-btn-ghost" type="button" data-action="reset-today">Reset today's session count</button>
            </div>

            <p class="ff-credit">Flow Finder v6 · <a href="https://winwithflynn.com/flow-finder/">winwithflynn.com</a></p>
          </div>
        </div>
      </div>
    `;
  }

  function render(tickOnly) {
    if (!root.querySelector('.ff')) buildScaffold();

    const ff = root.querySelector('.ff');
    const mode = FLOW_MODES[state.modeId];

    // Phase + running state on root data attrs (drives CSS)
    ff.dataset.phase = phase;
    ff.dataset.running = isRunning ? 'true' : 'false';
    ff.dataset.activeMode = state.modeId; // separate name from data-mode used on tabs

    // Time
    const ms = isRunning && endTime ? Math.max(0, endTime - Date.now()) : remainingMs;
    const totalSec = Math.ceil(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    ff.querySelector('.ff-mins').textContent = String(mins).padStart(2, '0');
    ff.querySelector('.ff-secs').textContent = String(secs).padStart(2, '0');

    // Progress ring
    const totalMs = modeMins(phase) * 60 * 1000;
    const elapsed = totalMs - ms;
    const pct = Math.max(0, Math.min(1, elapsed / totalMs));
    const circumference = 2 * Math.PI * 92;
    const bar = ff.querySelector('.ff-progress-bar');
    bar.style.strokeDasharray = String(circumference);
    bar.style.strokeDashoffset = String(circumference * (1 - pct));

    // Tab title
    if (isRunning) {
      const phaseLabel = phase === 'work' ? 'Focus' : 'Break';
      document.title = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')} · ${phaseLabel} — Flow Finder`;
    } else if (document.title.includes('·')) {
      // Reset to original title (best-effort)
      document.title = 'Flow Finder | Find Your Flow. Do Your Best Work. - Win With Flynn';
    }

    if (tickOnly) return;

    // Modes (tabs)
    const modesEl = ff.querySelector('.ff-modes');
    modesEl.innerHTML = Object.values(FLOW_MODES).map(m => `
      <button type="button" role="tab"
              class="ff-mode-tab ${m.id === state.modeId ? 'is-active' : ''}"
              data-mode="${m.id}"
              aria-selected="${m.id === state.modeId}">
        <span class="ff-mode-label">${m.label}</span>
        ${m.short ? `<span class="ff-mode-short">${m.short}</span>` : ''}
      </button>
    `).join('');

    // Phase label
    ff.querySelector('.ff-phase-text').textContent = phase === 'work' ? 'Focus' : 'Break';

    // Status dot label (this is the "running/idle" indicator — single source of truth)
    const dot = ff.querySelector('.ff-status-dot');
    dot.dataset.state = isRunning ? 'running' : 'idle';
    dot.setAttribute('aria-label', isRunning ? 'Running' : 'Idle');

    // Primary button
    const primary = ff.querySelector('[data-action="toggle"]');
    primary.textContent = isRunning ? 'Pause' : 'Start';

    // Break tip
    const tipEl = ff.querySelector('.ff-tip');
    if (phase === 'break' && currentBreakTip) {
      tipEl.textContent = currentBreakTip;
      tipEl.hidden = false;
    } else {
      tipEl.hidden = true;
    }

    // Today counter
    ff.querySelector('.ff-today-count').textContent = state.today.sessions;
    ff.querySelector('.ff-today-mins').textContent = state.today.focusedMinutes;

    // Tasks
    renderTasks();

    // Settings modal contents (in case it's open)
    renderSettings();
  }

  function renderTasks() {
    const list = root.querySelector('.ff-task-list');
    if (!list) return;
    if (!state.tasks.length) {
      list.innerHTML = `<p class="ff-empty">No tasks yet. Add one to track your focus sessions against real work.</p>`;
      return;
    }
    list.innerHTML = state.tasks.map(t => {
      const isActive = t.id === state.activeTaskId;
      const progress = t.estimate ? `${t.done}/${t.estimate}` : `${t.done}`;
      return `
        <div class="ff-task ${t.completed ? 'is-done' : ''} ${isActive ? 'is-active' : ''}" data-task-id="${t.id}" role="listitem">
          <button class="ff-task-check" type="button" data-task-action="toggle" aria-label="${t.completed ? 'Mark incomplete' : 'Mark complete'}">
            ${t.completed
              ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
              : ''}
          </button>
          <button class="ff-task-text" type="button" data-task-action="activate" title="Set as current task">
            ${escapeHtml(t.text)}
          </button>
          <span class="ff-task-progress">${progress}</span>
          <button class="ff-task-del" type="button" data-task-action="delete" aria-label="Delete task">×</button>
        </div>
      `;
    }).join('');
  }

  function renderSettings() {
    const modal = root.querySelector('[data-modal="settings"]');
    if (!modal || modal.hidden) return;

    // Sound grid
    const grid = modal.querySelector('.ff-sound-grid');
    grid.innerHTML = Object.entries(SOUNDS).map(([id, s]) => `
      <div class="ff-sound-row ${id === state.soundId ? 'is-selected' : ''}" data-sound-id="${id}">
        <button class="ff-sound-pick" type="button" data-sound-action="pick">
          <span class="ff-sound-name">${s.label}</span>
          <span class="ff-sound-desc">${s.desc}</span>
        </button>
        <button class="ff-sound-preview" type="button" data-sound-action="preview" aria-label="Preview sound">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>
        </button>
      </div>
    `).join('');

    // Volume
    modal.querySelector('.ff-volume').value = String(state.volume);

    // Custom mode controls
    const customGrp = modal.querySelector('[data-custom-only]');
    customGrp.hidden = state.modeId !== 'custom';
    if (state.modeId === 'custom') {
      modal.querySelector('.ff-custom-work').value = state.customWork;
      modal.querySelector('.ff-custom-break').value = state.customBreak;
    }

    // Notification status
    const notifStatus = modal.querySelector('.ff-notif-status');
    if (!('Notification' in window)) {
      notifStatus.textContent = 'Not supported in this browser.';
    } else if (Notification.permission === 'granted') {
      notifStatus.textContent = '✓ Enabled';
      notifStatus.style.color = 'var(--ff-success)';
    } else if (Notification.permission === 'denied') {
      notifStatus.textContent = 'Blocked. Enable in browser settings.';
    } else {
      notifStatus.textContent = '';
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // -------------------------------------------------------------------------
  // EVENTS
  // -------------------------------------------------------------------------

  root.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    const modeBtn = e.target.closest('[data-mode]');
    const taskAction = e.target.closest('[data-task-action]');
    const soundAction = e.target.closest('[data-sound-action]');

    if (modeBtn) {
      setMode(modeBtn.dataset.mode);
      return;
    }

    if (action === 'toggle') {
      isRunning ? pauseTimer() : startTimer();
      return;
    }
    if (action === 'reset') { resetTimer(); return; }
    if (action === 'skip') { skipPhase(); return; }
    if (action === 'clear-completed') { clearCompletedTasks(); return; }
    if (action === 'open-settings') { openSettings(); return; }
    if (action === 'enable-notifications') { requestNotificationPermission(); setTimeout(renderSettings, 200); return; }
    if (action === 'reset-today') {
      state.today = { date: todayString(), sessions: 0, focusedMinutes: 0 };
      saveState();
      render();
      return;
    }

    // Info popover
    if (e.target.closest('.ff-info-btn')) {
      togglePopover();
      return;
    }
    if (!e.target.closest('.ff-info-popover') && !e.target.closest('.ff-info-btn')) {
      closePopover();
    }

    // Task actions
    if (taskAction) {
      const taskEl = e.target.closest('[data-task-id]');
      const id = taskEl?.dataset.taskId;
      if (!id) return;
      if (taskAction.dataset.taskAction === 'toggle') toggleTaskComplete(id);
      else if (taskAction.dataset.taskAction === 'activate') setActiveTask(id);
      else if (taskAction.dataset.taskAction === 'delete') deleteTask(id);
      return;
    }

    // Sound actions
    if (soundAction) {
      const row = e.target.closest('[data-sound-id]');
      const id = row?.dataset.soundId;
      if (!id) return;
      if (soundAction.dataset.soundAction === 'pick') {
        state.soundId = id;
        saveState();
        renderSettings();
      } else if (soundAction.dataset.soundAction === 'preview') {
        previewSound(id);
      }
      return;
    }

    // Modal close + backdrop
    if (e.target.closest('.ff-modal-close') || e.target.classList.contains('ff-modal-backdrop')) {
      closeSettings();
    }
  });

  // Task form
  root.addEventListener('submit', (e) => {
    if (!e.target.matches('.ff-task-form')) return;
    e.preventDefault();
    const input = e.target.querySelector('.ff-task-input');
    const est = e.target.querySelector('.ff-task-est');
    addTask(input.value, est.value ? parseInt(est.value, 10) : null);
    input.value = '';
    est.value = '';
    input.focus();
  });

  // Volume + custom inputs (live)
  root.addEventListener('input', (e) => {
    if (e.target.classList.contains('ff-volume')) {
      state.volume = parseFloat(e.target.value);
      Object.values(audioElements).forEach(a => a.volume = state.volume);
      saveState();
    }
    if (e.target.classList.contains('ff-custom-work')) {
      const v = Math.max(1, Math.min(240, parseInt(e.target.value, 10) || 1));
      state.customWork = v;
      saveState();
      if (!isRunning && state.modeId === 'custom' && phase === 'work') {
        remainingMs = v * 60 * 1000;
        render();
      }
    }
    if (e.target.classList.contains('ff-custom-break')) {
      const v = Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 1));
      state.customBreak = v;
      saveState();
      if (!isRunning && state.modeId === 'custom' && phase === 'break') {
        remainingMs = v * 60 * 1000;
        render();
      }
    }
  });

  // Keyboard shortcut: spacebar to start/pause when not in an input
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    // Only intercept if the timer is in the viewport
    const ff = root.querySelector('.ff');
    if (!ff) return;
    const rect = ff.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    e.preventDefault();
    isRunning ? pauseTimer() : startTimer();
  });

  // -------------------------------------------------------------------------
  // POPOVER + MODAL
  // -------------------------------------------------------------------------

  function togglePopover() {
    const pop = root.querySelector('.ff-info-popover');
    const btn = root.querySelector('.ff-info-btn');
    if (pop.hidden) {
      const m = FLOW_MODES[state.modeId];
      pop.innerHTML = `
        <h4>${m.label}</h4>
        <p class="ff-pop-desc">${m.desc}</p>
        <p class="ff-pop-science"><strong>The science:</strong> ${m.science}</p>
        <p class="ff-pop-best"><strong>Best for:</strong> ${m.best}</p>
        <button class="ff-pop-close" type="button" aria-label="Close">×</button>
      `;
      pop.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      // Close button inside popover
      pop.querySelector('.ff-pop-close').addEventListener('click', closePopover);
    } else {
      closePopover();
    }
  }

  function closePopover() {
    const pop = root.querySelector('.ff-info-popover');
    const btn = root.querySelector('.ff-info-btn');
    if (pop && !pop.hidden) {
      pop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
  }

  function openSettings() {
    const modal = root.querySelector('[data-modal="settings"]');
    modal.hidden = false;
    renderSettings();
  }

  function closeSettings() {
    const modal = root.querySelector('[data-modal="settings"]');
    modal.hidden = true;
  }

  // Escape key closes modal/popover
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePopover();
      closeSettings();
    }
  });

  // -------------------------------------------------------------------------
  // INIT
  // -------------------------------------------------------------------------

  function init() {
    setupAudio();
    buildScaffold();
    render();
    console.log('Flow Finder v6 mounted.');
  }

  // Wait for DOM if needed
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
