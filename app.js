/**
 * Main Application
 * Coordinates M3U parsing, EPG parsing, stream validation, and video playback
 */

// Suppress non-critical console warnings from mpegts.js and other libraries
const originalWarn = console.warn;
const originalError = console.error;
console.warn = function(...args) {
    const msg = args[0]?.toString?.() || '';
    // Filter out mpegts SourceBuffer warnings
    if (msg.includes('SourceBuffer') || msg.includes('SourceBufferList')) {
        return; // Suppress
    }
    originalWarn.apply(console, args);
};
console.error = function(...args) {
    const msg = args[0]?.toString?.() || '';
    // Only suppress specific mpegts internal errors
    if (msg.includes('SourceBuffer') || msg.includes('SourceBufferList') || msg.includes('removeEventListener')) {
        return; // Suppress non-critical library errors
    }
    originalError.apply(console, args);
};

class M3UPlayerApp {
    constructor() {
        this.m3uParser = new M3UParser();
        this.epgParser = new EPGParser();
        this.streamValidator = new StreamValidator();
        this.mpegtsPlayer = null;
        this.currentChannel = null;
        this.channels = [];
        this.epgData = null;
        this.filteredChannels = [];

        // Persistent state
        this.storageKey = 'm3uPlayer.state.v1';
        this.favorites = new Set();
        this.recents = []; // array of { id, ts }
        this.channelOverrides = {}; // channelId -> { name?, group?, logo?, profile? }
        this.channelHealth = {}; // channelId -> 'ok' | 'warn' | 'bad' | undefined
        this.settings = {
            profile: 'default',
            accent: '#2196F3',
            audioFollowsSlot: false
        };
        this._saveTimer = null;

        // Multiview state
        this.isMultiviewMode = false;
        this.multiviewPlayers = [null, null, null, null]; // 4 player slots
        this.multiviewChannels = [null, null, null, null]; // 4 channel slots
        this.activeMultiviewSlot = 0; // Currently selected slot for loading a new channel
        this.activeMultiviewAudioSlot = null; // null means "mute all"
        this.swapPendingSlot = null;

        // Stream recovery state
        this.streamHealthMonitors = {}; // Track health per channel/slot
        this.recoveryAttempts = {}; // Track retry attempts
        this.maxRecoveryAttempts = 5;
        this.healthCheckInterval = 3000; // Check every 3 seconds
        this.recoveryDelays = [5000, 10000, 20000, 40000, 60000]; // Escalating delays (5s, 10s, 20s, 40s, 60s)

        // Party/Group Watching state
        this.partyCode = null;
        this.partyUsername = 'Friend';
        this.isPartyHost = false;
        this.partyMembers = [];
        this.partySyncLoop = null;
        this.partyChatPollLoop = null;
        this.lastChatTimestamp = 0;
        this.userColors = {}; // Store color per username
        this.partyLastSeekTime = 0; // Track last seek to avoid loops
        this.sentMessageIds = new Set(); // Track sent messages to avoid duplicates
        this.isSendingMessage = false; // Prevent double sends

        // Player controls state
        this.volume = 100;
        this.currentAspectRatio = '16:9';
        this.lastWatchedChannelId = null; // For auto-resume
        this.bufferStatus = 'ready'; // ready, buffering, error
        this.showFullscreenChannelSwitcher = false;

        // Recording state
        this.isRecording = false;
        this.recordingStartTime = null;
        this.recordings = []; // Array of {id, filename, channel, startTime, duration, size, timestamp}
        this.scheduledRecordings = []; // Array of {id, channel, startTime, duration, scheduled}

        this.initializeElements();
        this.attachEventListeners();
        this.loadPersistedState();
        this.applyThemeFromSettings();
        this.renderRecents();
        
        // Auto-load default playlist and EPG with welcome animation
        this.showWelcomeAnimation();
        setTimeout(() => this.loadDefaultPlaylistAndEPG(), 2000);
    }
    initializeElements() {
        // Input elements
        this.m3uInput = document.getElementById('m3uFile');
        this.m3uFileInput = document.getElementById('m3uFileInput');
        this.epgInput = document.getElementById('epgFile');
        this.epgFileInput = document.getElementById('epgFileInput');
        
        // Buttons
        this.clearBtn = document.getElementById('clearAll');
        this.exitMultiviewSidebarBtn = document.getElementById('exitMultiviewSidebarBtn');

        // If the sidebar exit button doesn't exist in the HTML, create it next to the clear button
        try {
            if (!this.exitMultiviewSidebarBtn && this.clearBtn && this.clearBtn.parentNode) {
                const btn = document.createElement('button');
                btn.className = 'btn-secondary';
                btn.id = 'exitMultiviewSidebarBtn';
                btn.style.display = 'none';
                btn.textContent = 'Exit Multiview';
                this.clearBtn.parentNode.appendChild(btn);
                this.exitMultiviewSidebarBtn = btn;
            }
        } catch (e) {
            // ignore DOM creation errors
        }
        this.toggleSidebarBtn = document.getElementById('toggleSidebar');
        this.toggleMultiviewBtn = document.getElementById('toggleMultiview');
        this.fullscreenLayoutBtn = document.getElementById('fullscreenLayout');
        // Player toolbar container
        this.playerToolbar = document.getElementById('playerToolbar');

        // Player toolbar buttons
        this.pipBtn = document.getElementById('pipBtn');
        this.reloadBtn = document.getElementById('reloadBtn');
        this.copyUrlBtn = document.getElementById('copyUrlBtn');
        this.openUrlBtn = document.getElementById('openUrlBtn');
        this.healthCheckBtn = document.getElementById('healthCheckBtn');
        this.settingsBtn = document.getElementById('settingsBtn');

        // Sidebar quick
        this.favoritesOnlyToggle = document.getElementById('favoritesOnly');
        this.recentsContainer = document.getElementById('recentsContainer');
        this.recentsList = document.getElementById('recentsList');
        this.clearRecentsBtn = document.getElementById('clearRecents');
        this.channelsMeta = document.getElementById('channelsMeta');

        // Now playing
        this.nowPlayingTitle = document.getElementById('nowPlayingTitle');
        this.nowPlayingSub = document.getElementById('nowPlayingSub');

        // Player controls
        this.keyboardHints = document.getElementById('keyboardHints');
        this.channelSwitcherModal = document.getElementById('channelSwitcherModal');
        this.closeChannelSwitcherBtn = document.getElementById('closeChannelSwitcherBtn');
        this.channelSwitcherList = document.getElementById('channelSwitcherList');

        // Modals
        this.settingsModal = document.getElementById('settingsModal');
        this.profileSelect = document.getElementById('profileSelect');
        this.accentColorInput = document.getElementById('accentColor');
        this.audioFollowsSlotToggle = document.getElementById('audioFollowsSlot');

        this.editChannelModal = document.getElementById('editChannelModal');
        this.editChannelIdInput = document.getElementById('editChannelId');
        this.editChannelNameInput = document.getElementById('editChannelName');
        this.editChannelGroupInput = document.getElementById('editChannelGroup');
        this.editChannelLogoInput = document.getElementById('editChannelLogo');
        this.editChannelProfileSelect = document.getElementById('editChannelProfile');
        this.saveChannelEditsBtn = document.getElementById('saveChannelEdits');
        this.resetChannelEditsBtn = document.getElementById('resetChannelEdits');

        // EPG toggle removed - EPG is now always in sidebar
        
        // Filters
        this.categoryFilter = document.getElementById('categoryFilter');
        this.searchInput = document.getElementById('searchChannels');
        
        // Display elements
        this.channelsList = document.getElementById('channelsList');
        this.videoPlayer = document.getElementById('videoPlayer');
        this.playerOverlay = document.getElementById('playerOverlay');
        this.playerWrapper = document.getElementById('playerWrapper');
        this.currentChannelName = document.getElementById('currentChannelName');
        this.currentChannelInfo = document.getElementById('currentChannelInfo');
        this.epgContent = document.getElementById('epgSidebarContent');
        this.loading = document.getElementById('loading');
        this.cancelLoadingBtn = document.getElementById('cancelLoading');
        this.toast = document.getElementById('toast');
        this.sidebar = document.getElementById('sidebar');
        this.isLoadingCancelled = false;
        this.currentLoadPromise = null;
        
        // Multiview elements
        this.multiViewGrid = document.getElementById('multiViewGrid');
        this.multiviewSlots = [];
        this.multiviewVideos = [];
        this.multiviewOverlays = [];
        this.multiviewLabels = [];
        this.multiviewAudioButtons = [];
        for (let i = 0; i < 4; i++) {
            this.multiviewSlots.push(document.querySelector(`[data-slot-index="${i}"]`));
            this.multiviewVideos.push(document.getElementById(`mvVideo${i}`));
            this.multiviewOverlays.push(document.getElementById(`mvOverlay${i}`));
            this.multiviewLabels.push(document.getElementById(`mvLabel${i}`));
            this.multiviewAudioButtons.push(document.getElementById(`mvAudioBtn${i}`));
        }
    }

    attachEventListeners() {
        // Clear button
        if (this.clearBtn) {
            this.clearBtn.addEventListener('click', () => this.clearAll());
        }
        
        // File inputs
        if (this.m3uFileInput) {
            this.m3uFileInput.addEventListener('change', (e) => this.handleFileInput(e, 'm3u'));
        }
        if (this.epgFileInput) {
            this.epgFileInput.addEventListener('change', (e) => this.handleFileInput(e, 'epg'));
        }
        
        // Toggle sidebar
        if (this.toggleSidebarBtn) {
            this.toggleSidebarBtn.addEventListener('click', () => this.toggleSidebar());
        }
        
        // Multiview and layout buttons
        if (this.toggleMultiviewBtn) {
            this.toggleMultiviewBtn.addEventListener('click', () => this.toggleMultiview());
        }
        // Sidebar exit multiview button (may have been created dynamically)
        if (this.exitMultiviewSidebarBtn) {
            this.exitMultiviewSidebarBtn.addEventListener('click', () => this.exitMultiview());
        }
        if (this.fullscreenLayoutBtn) {
            this.fullscreenLayoutBtn.addEventListener('click', () => this.toggleFullscreenLayout());
        }
        
        // Multiview slots
        this.multiviewSlots.forEach((slot, index) => {
            if (slot) {
                slot.addEventListener('click', () => {
                    this.selectMultiviewSlot(index);
                    if (this.settings.audioFollowsSlot) {
                        this.setMultiviewAudioSlotExplicit(index);
                    }
                });
            }
        });

        // Multiview audio buttons (stop propagation so it doesn't also select/load accidentally)
        this.multiviewAudioButtons.forEach((btn, index) => {
            if (btn) {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.setMultiviewAudioSlot(index);
                });
            }
        });

        // Multiview slot actions (event delegation)
        if (this.multiViewGrid) {
            this.multiViewGrid.addEventListener('click', (e) => this.onMultiviewActionClick(e));
        }

        // Sidebar quick
        if (this.favoritesOnlyToggle) {
            this.favoritesOnlyToggle.addEventListener('change', () => this.applyFilters());
        }
        if (this.clearRecentsBtn) {
            this.clearRecentsBtn.addEventListener('click', () => this.clearRecents());
        }

        // Toolbar actions
        if (this.pipBtn) {
            this.pipBtn.addEventListener('click', () => this.togglePiP());
        }
        if (this.reloadBtn) {
            this.reloadBtn.addEventListener('click', () => this.reloadActive());
        }
        if (this.copyUrlBtn) {
            this.copyUrlBtn.addEventListener('click', () => this.copyActiveUrl());
        }
        if (this.openUrlBtn) {
            this.openUrlBtn.addEventListener('click', () => this.openActiveUrl());
        }
        if (this.healthCheckBtn) {
            this.healthCheckBtn.addEventListener('click', () => this.checkVisibleHealth());
        }
        if (this.settingsBtn) {
            this.settingsBtn.addEventListener('click', () => this.openModal('settingsModal'));
        }

        // Modal close handlers
        document.querySelectorAll('[data-close-modal]').forEach(el => {
            if (el) {
                el.addEventListener('click', () => this.closeModal(el.getAttribute('data-close-modal')));
            }
        });

        // Settings inputs
        if (this.profileSelect) {
            this.profileSelect.addEventListener('change', () => {
                this.settings.profile = this.profileSelect.value;
                this.savePersistedState();
                this.showToast('Playback profile updated (applies on next load/reload)', 'success');
            });
        }
        if (this.accentColorInput) {
            this.accentColorInput.addEventListener('input', () => {
                this.settings.accent = this.accentColorInput.value;
                this.applyThemeFromSettings();
                this.savePersistedState();
            });
        }
        if (this.audioFollowsSlotToggle) {
            this.audioFollowsSlotToggle.addEventListener('change', () => {
                this.settings.audioFollowsSlot = !!this.audioFollowsSlotToggle.checked;
                this.savePersistedState();
            });
        }

        // Player controls
        if (this.closeChannelSwitcherBtn) {
            this.closeChannelSwitcherBtn.addEventListener('click', () => this.hideChannelSwitcherModal());
        }
        if (this.channelSwitcherModal) {
            this.channelSwitcherModal.addEventListener('click', (e) => {
                if (e.target === this.channelSwitcherModal) {
                    this.hideChannelSwitcherModal();
                }
            });
        }

        // Edit channel modal actions
        if (this.saveChannelEditsBtn) {
            this.saveChannelEditsBtn.addEventListener('click', () => this.saveChannelEdits());
        }
        if (this.resetChannelEditsBtn) {
            this.resetChannelEditsBtn.addEventListener('click', () => this.resetChannelEdits());
        }

        // EPG toggle removed
        
        // Category filter
        if (this.categoryFilter) {
            this.categoryFilter.addEventListener('change', () => this.applyFilters());
        }
        
        // Search input
        if (this.searchInput) {
            this.searchInput.addEventListener('input', () => this.applyFilters());
        }
        
        // Video player events
        if (this.videoPlayer) {
            this.videoPlayer.addEventListener('loadstart', () => this.onVideoLoadStart());
            this.videoPlayer.addEventListener('error', (e) => this.onVideoError(e));
            this.videoPlayer.addEventListener('play', () => this.hideOverlay());
            this.videoPlayer.addEventListener('playing', () => this.hideOverlay());
            this.videoPlayer.addEventListener('waiting', () => this.onVideoWaiting());
            this.videoPlayer.addEventListener('canplay', () => this.onVideoCanPlay());
            // Keep top toolbar visible and overlayed when video is playing
            this.videoPlayer.addEventListener('play', () => {
                try { document.body.classList.add('video-playing'); } catch (e) {}
            });
            this.videoPlayer.addEventListener('pause', () => {
                try { document.body.classList.remove('video-playing'); } catch (e) {}
            });
            this.videoPlayer.addEventListener('ended', () => {
                try { document.body.classList.remove('video-playing'); } catch (e) {}
            });
            // Safari / iOS Picture-in-Picture presentation mode change
            if (typeof this.videoPlayer.webkitSupportsPresentationMode === 'function') {
                this.videoPlayer.addEventListener('webkitpresentationmodechanged', () => {
                    try {
                        const mode = this.videoPlayer.webkitPresentationMode;
                        if (this.pipBtn) {
                            this.pipBtn.classList.toggle('active', mode === 'picture-in-picture');
                        }
                    } catch (e) {
                        // ignore
                    }
                });
            }
        }
        
        // Cancel loading button
        if (this.cancelLoadingBtn) {
            this.cancelLoadingBtn.addEventListener('click', () => this.cancelLoading());
        }
        
        // Party/Chat buttons
        const createPartyBtn = document.getElementById('createPartyBtn');
        const joinPartyBtn = document.getElementById('joinPartyBtn');
        const confirmJoinPartyBtn = document.getElementById('confirmJoinPartyBtn');
        const cancelJoinPartyBtn = document.getElementById('cancelJoinPartyBtn');
        const leavePartyBtn = document.getElementById('leavePartyBtn');
        const copyPartyCodeBtn = document.getElementById('copyPartyCodeBtn');
        const chatSendBtn = document.getElementById('chatSendBtn');
        const chatMessageInput = document.getElementById('chatMessageInput');
        const closeChatBtn = document.getElementById('closeChatBtn');

        if (createPartyBtn) {
            createPartyBtn.addEventListener('click', () => this.createParty());
        }
        if (joinPartyBtn) {
            joinPartyBtn.addEventListener('click', () => this.toggleJoinPartyForm());
        }
        if (confirmJoinPartyBtn) {
            confirmJoinPartyBtn.addEventListener('click', () => this.joinParty());
        }
        if (cancelJoinPartyBtn) {
            cancelJoinPartyBtn.addEventListener('click', () => this.toggleJoinPartyForm());
        }
        if (leavePartyBtn) {
            leavePartyBtn.addEventListener('click', () => this.leaveParty());
        }
        if (copyPartyCodeBtn) {
            copyPartyCodeBtn.addEventListener('click', () => this.copyPartyCode());
        }
        if (chatSendBtn) {
            chatSendBtn.addEventListener('click', () => this.sendChatMessage());
        }
        if (chatMessageInput) {
            chatMessageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendChatMessage();
                }
            });
        }
        if (closeChatBtn) {
            closeChatBtn.addEventListener('click', () => this.hideChatWidget());
        }
        
        const minimizeChatBtn = document.getElementById('minimizeChatBtn');
        if (minimizeChatBtn) {
            minimizeChatBtn.addEventListener('click', () => this.toggleMinimizeChatWidget());
        }

        // Chat widget draggable
        this.initializeChatDragable();

        // Party modal close handlers
        const closePartyModalBtn = document.getElementById('closePartyModalBtn');
        const partyModalBackdrop = document.getElementById('partyModalBackdrop');
        
        if (closePartyModalBtn) {
            closePartyModalBtn.addEventListener('click', () => this.togglePartyModal());
        }
        if (partyModalBackdrop) {
            partyModalBackdrop.addEventListener('click', () => this.togglePartyModal());
        }
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));

        // Fullscreen change: auto-hide sidebars when fullscreen is active
        document.addEventListener('fullscreenchange', () => this.onFullscreenChange());
    }

    handleKeyboard(event) {
        // Don't handle shortcuts when typing in inputs
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
            return;
        }

        switch(event.key) {
            case 'ArrowUp':
                event.preventDefault();
                this.navigateChannels(-1);
                break;
            case 'ArrowDown':
                event.preventDefault();
                this.navigateChannels(1);
                break;
            case ' ':
                event.preventDefault();
                this.togglePlayPause();
                break;
            case 'f':
            case 'F':
                event.preventDefault();
                this.toggleFullscreen();
                break;
            case 'm':
            case 'M':
                event.preventDefault();
                this.toggleMultiview();
                break;
            case 'l':
            case 'L':
                event.preventDefault();
                this.toggleFullscreenLayout();
                break;
            case 'r':
            case 'R':
                event.preventDefault();
                this.reloadActive();
                break;
            case 'p':
            case 'P':
                event.preventDefault();
                this.togglePiP();
                break;
            case 'Escape':
                if (this.isMultiviewMode) {
                    this.toggleMultiview();
                }
                if (document.body.classList.contains('is-fullscreen-layout')) {
                    this.toggleFullscreenLayout();
                }
                break;
        }
    }

    navigateChannels(direction) {
        if (this.filteredChannels.length === 0) return;
        
        const currentIndex = this.currentChannel 
            ? this.filteredChannels.findIndex(c => c.id === this.currentChannel.id)
            : -1;
        
        let newIndex = currentIndex + direction;
        if (newIndex < 0) newIndex = this.filteredChannels.length - 1;
        if (newIndex >= this.filteredChannels.length) newIndex = 0;
        
        this.playChannel(this.filteredChannels[newIndex]);
        
        // Scroll to channel in list
        const channelElement = document.querySelector(`[data-channel-id="${this.filteredChannels[newIndex].id}"]`);
        if (channelElement) {
            channelElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    // Helper: fetch with timeout and fallback to local proxy (returns text or raw content)
    async fetchWithProxyFallback(url, timeoutMs = 10000) {
        const isUrl = /^https?:\/\//i.test(url);
        if (!isUrl) return url; // treat as raw content

        // Try direct fetch first (fast path)
        try {
            const controller = new AbortController();
            const to = setTimeout(() => controller.abort(), timeoutMs);
            const res = await fetch(url, { signal: controller.signal, mode: 'cors' });
            clearTimeout(to);
            if (!res.ok) throw new Error('Network response not OK');
            return await res.text();
        } catch (err) {
            console.warn('Direct fetch failed, falling back to proxy:', err);
            // Try local proxy (http://localhost:8001/proxy?url=...)
            try {
                const proxyUrl = `/proxy?url=${encodeURIComponent(url)}`;
                const controller2 = new AbortController();
                const to2 = setTimeout(() => controller2.abort(), Math.max(timeoutMs, 20000));
                const res2 = await fetch(proxyUrl, { signal: controller2.signal });
                clearTimeout(to2);
                if (!res2.ok) throw new Error(`Proxy fetch failed with ${res2.status}`);
                return await res2.text();
            } catch (err2) {
                console.error('Both direct and proxy fetch failed:', err, err2);
                throw new Error('Failed to load resource (direct and proxy failed)');
            }
        }
    }

    getActiveVideoElement() {
        if (this.isMultiviewMode) {
            return this.multiviewVideos[this.activeMultiviewSlot];
        }
        return this.videoPlayer;
    }

    togglePlayPause() {
        const video = this.getActiveVideoElement();
        if (!video) return;

        if (video.paused) {
            video.play();
        } else {
            video.pause();
        }
    }

    /**
     * Start monitoring stream health for auto-recovery
     * Detects when a stream stops unexpectedly and auto-reconnects
     */
    startStreamHealthMonitor(channel, isMultiviewSlot = null) {
        const monitorKey = isMultiviewSlot !== null ? `slot-${isMultiviewSlot}` : 'single';
        
        // Clear any existing monitor for this channel
        if (this.streamHealthMonitors[monitorKey]) {
            clearInterval(this.streamHealthMonitors[monitorKey]);
        }

        this.recoveryAttempts[monitorKey] = 0;
        this.sendDebugLog(`🔍 Stream health monitor started for ${channel.name}`);

        this.streamHealthMonitors[monitorKey] = setInterval(() => {
            this.checkStreamHealth(channel, monitorKey, isMultiviewSlot);
        }, this.healthCheckInterval);
    }

    /**
     * Check if stream is still playing, auto-recover if not
     */
    checkStreamHealth(channel, monitorKey, isMultiviewSlot) {
        let video = null;
        
        if (isMultiviewSlot !== null) {
            video = this.multiviewVideos[isMultiviewSlot];
        } else {
            video = this.videoPlayer;
        }

        if (!video) return;

        // Stream is stopped/errored (duration is valid but not playing)
        const isStalled = video.readyState < 2 && !video.paused && !video.seeking;
        const hasError = video.error !== null;
        const hasValidDuration = video.duration > 0 && isFinite(video.duration);

        if ((isStalled || hasError) && hasValidDuration) {
            // Check if we're still on the same channel
            const currentChannel = isMultiviewSlot !== null 
                ? this.multiviewChannels[isMultiviewSlot]
                : this.currentChannel;

            if (currentChannel && currentChannel.id === channel.id) {
                this.attemptStreamRecovery(channel, monitorKey, isMultiviewSlot);
            }
        }
    }

    /**
     * Attempt to recover a dead stream with exponential backoff
     */
    attemptStreamRecovery(channel, monitorKey, isMultiviewSlot) {
        const attempts = this.recoveryAttempts[monitorKey] || 0;

        if (attempts >= this.maxRecoveryAttempts) {
            this.sendDebugLog(`❌ Stream recovery failed after ${attempts} attempts`, 'ERROR');
            this.showToast(`Stream died - max recovery attempts reached for ${channel.name}`, 'error');
            this.stopStreamHealthMonitor(monitorKey);
            return;
        }

        const delay = this.recoveryDelays[attempts] || 60000;
        this.recoveryAttempts[monitorKey] = attempts + 1;

        this.sendDebugLog(`⚠️ Stream stalled for ${channel.name}. Recovery attempt ${attempts + 1}/${this.maxRecoveryAttempts} in ${delay}ms`);
        this.showToast(`Stream interrupted - attempting to reconnect... (${attempts + 1}/${this.maxRecoveryAttempts})`, 'warning');

        setTimeout(() => {
            this.sendDebugLog(`🔄 Reconnecting to ${channel.name}...`);
            
            if (isMultiviewSlot !== null) {
                this.reloadMultiviewSlot(isMultiviewSlot);
            } else {
                this.playChannel(channel);
            }
        }, delay);
    }

    /**
     * Stop monitoring stream health
     */
    stopStreamHealthMonitor(monitorKey = null) {
        if (monitorKey) {
            if (this.streamHealthMonitors[monitorKey]) {
                clearInterval(this.streamHealthMonitors[monitorKey]);
                delete this.streamHealthMonitors[monitorKey];
                delete this.recoveryAttempts[monitorKey];
            }
        } else {
            // Stop all monitors
            Object.keys(this.streamHealthMonitors).forEach(key => {
                clearInterval(this.streamHealthMonitors[key]);
            });
            this.streamHealthMonitors = {};
            this.recoveryAttempts = {};
        }
    }

    isIOS() {
        const isApple = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        return isApple;
    }

    toggleFullscreen() {
        const target = this.isMultiviewMode ? this.multiViewGrid : this.playerWrapper;
        if (!target) return;

        this.sendDebugLog('toggleFullscreen called');

        // Check if we're in standalone web app mode (added to home screen)
        const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
        const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
        const isFakeFullscreen = target.classList.contains('fake-fullscreen');
        this.sendDebugLog(`isFullscreen: ${isFullscreen}, isFakeFullscreen: ${isFakeFullscreen}, target: ${target ? target.tagName : 'null'}, standalone: ${isStandalone}`);

        // Exit fullscreen (native or fake)
        if (isFullscreen || isFakeFullscreen) {
            this.sendDebugLog('Exiting fullscreen...');
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
            if (isFakeFullscreen) {
                this.exitFakeFullscreen(target);
            }
            // Hide HUD
            if (this.keyboardHints) this.keyboardHints.style.display = 'none';
            return;
        }

        // Enter fullscreen
        if (target && target.requestFullscreen) {
            this.sendDebugLog('Calling requestFullscreen...');
            target.requestFullscreen().then(() => {
                this.sendDebugLog('requestFullscreen SUCCESS');
                // Show HUD
                if (this.keyboardHints) this.keyboardHints.style.display = 'block';
            }).catch(err => {
                this.sendDebugLog(`requestFullscreen FAILED: ${err.message}`, 'ERROR');
                // Fallback for standalone mode where fullscreen API doesn't work
                if (isStandalone) {
                    this.enterFakeFullscreen(target);
                    if (this.keyboardHints) this.keyboardHints.style.display = 'block';
                }
            });
        } else if (target && target.webkitRequestFullscreen) {
            this.sendDebugLog('Calling webkitRequestFullscreen...');
            target.webkitRequestFullscreen();
            // Show HUD
            if (this.keyboardHints) this.keyboardHints.style.display = 'block';
            this.sendDebugLog('webkitRequestFullscreen SUCCESS');
        } else if (isStandalone) {
            // Standalone mode fallback when no fullscreen API available
            this.sendDebugLog('Using fake fullscreen for standalone mode');
            this.enterFakeFullscreen(target);
            if (this.keyboardHints) this.keyboardHints.style.display = 'block';
        } else {
            this.sendDebugLog('requestFullscreen not available', 'ERROR');
        }
    }

    enterFakeFullscreen(target) {
        // CSS-based fullscreen for standalone web app mode
        target.classList.add('fake-fullscreen');
        document.body.classList.add('is-fullscreen-layout');
        this.sendDebugLog('Entered fake fullscreen mode');
    }

    exitFakeFullscreen(target) {
        target.classList.remove('fake-fullscreen');
        document.body.classList.remove('is-fullscreen-layout');
        this.sendDebugLog('Exited fake fullscreen mode');
    }

    onFullscreenChange() {
        // When actually fullscreen, hide sidebars for a cleaner fullscreen UI.
        const isFs = !!document.fullscreenElement;
        document.body.classList.toggle('is-actual-fullscreen', isFs);
    }

    onVideoWaiting() {
        // Show buffering indicator
        if (!this.videoPlayer.paused) {
            this.showOverlay();
            this.currentChannelInfo.textContent = 'Buffering...';
        }
    }

    onVideoCanPlay() {
        // Hide overlay when video can play
        if (!this.videoPlayer.paused) {
            this.hideOverlay();
        }
    }

    async loadPlaylist() {
        const m3uSource = this.m3uInput.value.trim();
        const epgSource = this.epgInput.value.trim();
        
        if (!m3uSource) {
            this.showToast('Please provide an M3U playlist URL or file', 'error');
            return;
        }

        try {
            this.showLoading(true);
            
            // Load M3U playlist using proxy fallback for CORS + speed
            let m3uContent;
            if (/^https?:\/\//i.test(m3uSource)) {
                m3uContent = await this.fetchWithProxyFallback(m3uSource, 10000);
            } else {
                m3uContent = m3uSource; // raw content or filename
            }
            
            this.channels = await this.m3uParser.parse(m3uContent);
            
            if (this.channels.length === 0) {
                throw new Error('No channels found in playlist');
            }
            
            this.showToast(`Loaded ${this.channels.length} channels`, 'success');
            
            // Load EPG if provided
            if (epgSource) {
                try {
                    console.log('Loading EPG from:', epgSource);
                    let epgContent;
                    if (/^https?:\/\//i.test(epgSource)) {
                        epgContent = await this.fetchWithProxyFallback(epgSource, 10000);
                    } else {
                        epgContent = epgSource;
                    }
                    this.epgData = await this.epgParser.parse(epgContent);
                    const aligned = this.epgParser.alignWithChannels(this.channels);
                    this.epgData.aligned = aligned;
                    const alignedCount = aligned.size || 0;
                    console.log(`EPG loaded: ${alignedCount} channels aligned`);
                    this.showToast(`EPG loaded (${alignedCount} channels)`, 'success');
                } catch (error) {
                    console.error('EPG loading failed:', error);
                    const errorMsg = error.message || 'Unknown error';
                    if (errorMsg.includes('timeout') || errorMsg.includes('Failed to fetch')) {
                        this.showToast('EPG timeout - check network connection', 'warning');
                    } else {
                        this.showToast(`EPG failed: ${errorMsg.substring(0, 50)}`, 'warning');
                    }
                }
            }
            
            // Update UI
            this.updateCategoryFilter();
            this.applyFilters();
            this.renderRecents();
            
        } catch (error) {
            console.error('Error loading playlist:', error);
            this.showToast(`Error: ${error.message}`, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    handleFileInput(event, type) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            if (type === 'm3u') {
                this.m3uInput.value = file.name;
                // Store content for later use
                this.m3uFileContent = content;
                // Parse directly from content
                setTimeout(() => {
                    this.m3uParser.parse(content).then(channels => {
                        this.channels = channels;
                        this.updateCategoryFilter();
                        this.applyFilters();
                        this.showToast(`Loaded ${channels.length} channels from file`, 'success');
                    }).catch(err => {
                        this.showToast(`Error parsing file: ${err.message}`, 'error');
                    });
                }, 100);
            } else if (type === 'epg') {
                this.epgInput.value = file.name;
                this.epgFileContent = content;
                setTimeout(() => {
                    this.epgParser.parse(content).then(data => {
                        this.epgData = data;
                        const aligned = this.epgParser.alignWithChannels(this.channels);
                        this.epgData.aligned = aligned;
                        this.showToast('EPG loaded from file', 'success');
                        if (this.currentChannel) {
                            this.updateEPGDisplay(this.currentChannel);
                        }
                    }).catch(err => {
                        this.showToast(`Error parsing EPG: ${err.message}`, 'error');
                    });
                }, 100);
            }
        };
        reader.readAsText(file);
    }

    updateCategoryFilter() {
        const categories = new Set(this.m3uParser.getCategories());

        // Include custom override groups
        Object.values(this.channelOverrides || {}).forEach(ov => {
            if (ov && ov.group && ov.group.trim()) {
                categories.add(ov.group.trim());
            }
        });

        const sorted = Array.from(categories).sort();

        this.categoryFilter.innerHTML = '<option value="">All Categories</option>';
        sorted.forEach(category => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            this.categoryFilter.appendChild(option);
        });
    }

    applyFilters() {
        let filtered = [...this.channels]; // Create a copy

        // Favorites only
        if (this.favoritesOnlyToggle && this.favoritesOnlyToggle.checked) {
            filtered = filtered.filter(ch => this.favorites.has(ch.id));
        }
        
        // Apply category filter
        const category = this.categoryFilter.value;
        if (category) {
            filtered = filtered.filter(channel => {
                const display = this.getChannelDisplay(channel);
                return (display.category || channel.groupTitle) === category;
            });
        }
        
        // Apply search filter
        const searchQuery = this.searchInput.value.trim();
        if (searchQuery) {
            const lowerQuery = searchQuery.toLowerCase();
            filtered = filtered.filter(channel => {
                const display = this.getChannelDisplay(channel);
                return (
                    display.name.toLowerCase().includes(lowerQuery) ||
                    (channel.tvgName && channel.tvgName.toLowerCase().includes(lowerQuery)) ||
                    (display.category && display.category.toLowerCase().includes(lowerQuery))
                );
            });
        }
        
        this.filteredChannels = filtered;
        this.renderChannels();
    }

    // ============ Persistence + UI helpers ============

    loadPersistedState() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            if (!raw) {
                // defaults
                this.profileSelect.value = this.settings.profile;
                this.accentColorInput.value = this.settings.accent;
                this.audioFollowsSlotToggle.checked = !!this.settings.audioFollowsSlot;
                // Load defaults for volume and aspect
                const savedVolume = localStorage.getItem('m3u.volume');
                if (savedVolume) {
                    this.volume = parseInt(savedVolume);
                    this.updateVolume();
                }
                const savedAspect = localStorage.getItem('m3u.aspectRatio') || '16:9';
                this.setAspectRatio(savedAspect);
                return;
            }

            const parsed = JSON.parse(raw);

            if (Array.isArray(parsed.favorites)) {
                this.favorites = new Set(parsed.favorites);
            }
            if (Array.isArray(parsed.recents)) {
                this.recents = parsed.recents.filter(r => r && r.id).slice(0, 20);
            }
            if (parsed.channelOverrides && typeof parsed.channelOverrides === 'object') {
                this.channelOverrides = parsed.channelOverrides;
            }
            if (parsed.settings && typeof parsed.settings === 'object') {
                this.settings = {
                    ...this.settings,
                    ...parsed.settings
                };
            }
        } catch (e) {
            console.warn('Failed to load persisted state:', e);
        }

        // hydrate inputs
        if (this.profileSelect) this.profileSelect.value = this.settings.profile || 'default';
        if (this.accentColorInput) this.accentColorInput.value = this.settings.accent || '#2196F3';
        if (this.audioFollowsSlotToggle) this.audioFollowsSlotToggle.checked = !!this.settings.audioFollowsSlot;
        
        // Load volume and aspect ratio
        const savedVolume = localStorage.getItem('m3u.volume');
        if (savedVolume) {
            this.volume = parseInt(savedVolume);
            this.updateVolume();
        } else {
            this.updateVolume(); // Initialize with default 100%
        }
        
        const savedAspect = localStorage.getItem('m3u.aspectRatio') || '16:9';
        this.setAspectRatio(savedAspect);
    }

    showWelcomeAnimation() {
        const welcome = document.getElementById('welcomeAnimation');
        if (welcome) {
            welcome.style.display = 'flex';
            setTimeout(() => {
                welcome.style.opacity = '1';
            }, 50);
        }
    }

    hideWelcomeAnimation() {
        const welcome = document.getElementById('welcomeAnimation');
        if (welcome) {
            welcome.style.opacity = '0';
            setTimeout(() => {
                welcome.style.display = 'none';
            }, 800);
        }
    }

    loadDefaultPlaylistAndEPG() {
        const m3uUrl = this.m3uInput.value;
        const epgUrl = this.epgInput.value;
        
        this.sendDebugLog('Auto-loading defaults: M3U=' + m3uUrl.substring(0, 50) + '...');
        
        if (!m3uUrl) {
            this.hideWelcomeAnimation();
            return;
        }

        this.loadPlaylist(() => {
            // After playlist loads, try to resume last watched channel
            setTimeout(() => this.resumeLastChannel(), 500);
        });
        this.hideWelcomeAnimation();
    }

    savePersistedState() {
        // debounce
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            try {
                const payload = {
                    favorites: Array.from(this.favorites),
                    recents: this.recents.slice(0, 20),
                    channelOverrides: this.channelOverrides,
                    settings: this.settings
                };
                localStorage.setItem(this.storageKey, JSON.stringify(payload));
                localStorage.setItem('m3u.volume', this.volume);
                localStorage.setItem('m3u.aspectRatio', this.currentAspectRatio);
            } catch (e) {
                console.warn('Failed to save state:', e);
            }
        }, 250);
    }

    applyThemeFromSettings() {
        const accent = this.settings.accent || '#2196F3';
        document.documentElement.style.setProperty('--primary-color', accent);
        document.documentElement.style.setProperty('--accent', accent);
    }

    getEffectiveProfileName(channel) {
        const ov = channel ? (this.channelOverrides[channel.id] || {}) : {};
        const candidate = (ov.profile || this.settings.profile || 'default').trim();
        if (candidate === 'lowlatency' || candidate === 'stable' || candidate === 'default') {
            return candidate;
        }
        return 'default';
    }

    getMpegtsPlayerConfig(url, profileName) {
        // IMPORTANT: default profile must remain exactly the same as the original config.
        const baseDefault = {
            type: 'mpegts',
            isLive: true,
            url: url,
            // Optimize for better buffering
            enableWorker: true,
            enableStashBuffer: true, // Enable stash buffer for better streaming
            stashInitialSize: 512, // Large cache buffer for smooth playback
            autoCleanupSourceBuffer: true,
            accurateSeek: false,
            seekType: 'range', // Use range requests for better performance
            seekParamStart: 'bstart',
            seekParamEnd: 'bend',
            rangeLoadZeroStart: false,
            liveSyncLatencyChasing: true, // Chase latency for live streams
            liveSyncLatency: 1, // Reduced from 1.5 for lower latency
            liveMaxLatencyDuration: 2, // Reduced from 3
            liveDurationInfinity: true,
            liveBackBufferLength: 0 // No back buffer for live streams
        };

        if (profileName === 'lowlatency') {
            return {
                ...baseDefault,
                enableStashBuffer: false,
                stashInitialSize: 64,
                liveSyncLatency: 1.0,
                liveMaxLatencyDuration: 2
            };
        }

        if (profileName === 'stable') {
            return {
                ...baseDefault,
                enableStashBuffer: true,
                stashInitialSize: 512,
                liveSyncLatency: 3.0,
                liveMaxLatencyDuration: 7
            };
        }

        return baseDefault;
    }

    getChannelById(channelId) {
        return this.channels.find(c => c.id === channelId) || null;
    }

    getChannelDisplay(channel) {
        const override = this.channelOverrides[channel.id] || {};
        const name = (override.name || '').trim() || channel.name;
        const category = (override.group || '').trim() || channel.category || channel.groupTitle || 'Uncategorized';
        const logoUrl = (override.logo || '').trim() || channel.tvgLogo || channel.logo || 'https://via.placeholder.com/60x40?text=No+Logo';
        return { name, category, logoUrl, override };
    }

    toggleFavorite(channelId) {
        if (this.favorites.has(channelId)) {
            this.favorites.delete(channelId);
        } else {
            this.favorites.add(channelId);
        }
        this.savePersistedState();
        this.applyFilters();
    }

    addRecent(channelId) {
        const now = Date.now();
        this.recents = [{ id: channelId, ts: now }, ...this.recents.filter(r => r.id !== channelId)].slice(0, 20);
        this.savePersistedState();
        this.renderRecents();
    }

    clearRecents() {
        this.recents = [];
        this.savePersistedState();
        this.renderRecents();
    }

    renderRecents() {
        if (!this.recentsContainer || !this.recentsList) return;

        if (!this.recents.length) {
            this.recentsContainer.style.display = 'none';
            this.recentsList.innerHTML = '';
            return;
        }

        this.recentsContainer.style.display = 'block';
        this.recentsList.innerHTML = '';

        for (const r of this.recents) {
            const ch = this.getChannelById(r.id);
            if (!ch) continue;
            const display = this.getChannelDisplay(ch);

            const el = document.createElement('div');
            el.className = 'recent-item';
            el.textContent = display.name;
            el.addEventListener('click', () => this.playChannel(ch));
            this.recentsList.appendChild(el);
        }
    }

    getProgramsForChannel(channel) {
        if (!this.epgData || !this.epgData.aligned) return [];
        return this.epgData.aligned.get(channel.id) || [];
    }

    getNowNextPlain(channel) {
        const programs = this.getProgramsForChannel(channel);
        if (!programs || !programs.length) return '';

        const now = Date.now();
        const current = programs.find(p => p.start <= now && p.stop >= now);
        const next = programs.find(p => p.start > now);
        const curTitle = current?.title ? current.title : '';
        const nextTitle = next?.title ? next.title : '';

        if (curTitle && nextTitle) return `Now: ${curTitle} • Next: ${nextTitle}`;
        if (curTitle) return `Now: ${curTitle}`;
        if (nextTitle) return `Next: ${nextTitle}`;
        return '';
    }

    getNowNextText(channel) {
        const programs = this.getProgramsForChannel(channel);
        if (!programs || !programs.length) return '';

        const now = Date.now();
        const current = programs.find(p => p.start <= now && p.stop >= now);
        const next = programs.find(p => p.start > now);

        const curTitle = current?.title ? this.escapeHtml(current.title) : '';
        const nextTitle = next?.title ? this.escapeHtml(next.title) : '';

        if (curTitle && nextTitle) return `<strong>Now:</strong> ${curTitle} • <strong>Next:</strong> ${nextTitle}`;
        if (curTitle) return `<strong>Now:</strong> ${curTitle}`;
        if (nextTitle) return `<strong>Next:</strong> ${nextTitle}`;
        return '';
    }

    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        // hydrate settings modal values
        if (modalId === 'settingsModal') {
            this.profileSelect.value = this.settings.profile || 'default';
            this.accentColorInput.value = this.settings.accent || '#2196F3';
            this.audioFollowsSlotToggle.checked = !!this.settings.audioFollowsSlot;
        }

        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
    }

    openEditChannelModal(channelId) {
        const channel = this.getChannelById(channelId);
        if (!channel) return;

        const override = this.channelOverrides[channelId] || {};

        this.editChannelIdInput.value = channelId;
        this.editChannelNameInput.value = override.name || '';
        this.editChannelGroupInput.value = override.group || '';
        this.editChannelLogoInput.value = override.logo || '';
        this.editChannelProfileSelect.value = override.profile || '';

        this.openModal('editChannelModal');
    }

    saveChannelEdits() {
        const channelId = this.editChannelIdInput.value;
        if (!channelId) return;

        const name = (this.editChannelNameInput.value || '').trim();
        const group = (this.editChannelGroupInput.value || '').trim();
        const logo = (this.editChannelLogoInput.value || '').trim();
        const profile = (this.editChannelProfileSelect.value || '').trim();

        if (!name && !group && !logo && !profile) {
            delete this.channelOverrides[channelId];
        } else {
            this.channelOverrides[channelId] = { name, group, logo, profile };
        }

        this.savePersistedState();
        this.updateCategoryFilter();
        this.applyFilters();
        if (this.currentChannel && this.currentChannel.id === channelId) {
            this.setCurrentChannel(this.currentChannel);
        }
        this.closeModal('editChannelModal');
        this.showToast('Channel updated', 'success');
    }

    resetChannelEdits() {
        const channelId = this.editChannelIdInput.value;
        if (!channelId) return;

        delete this.channelOverrides[channelId];
        this.savePersistedState();
        this.updateCategoryFilter();
        this.applyFilters();
        this.closeModal('editChannelModal');
        this.showToast('Channel reset', 'success');
    }

    getActiveChannel() {
        if (this.isMultiviewMode) {
            return this.multiviewChannels[this.activeMultiviewSlot] || null;
        }
        return this.currentChannel;
    }

    async reloadActive() {
        if (this.isMultiviewMode) {
            return this.reloadMultiviewSlot(this.activeMultiviewSlot);
        }
        return this.reloadSingle();
    }

    async reloadSingle() {
        const channel = this.currentChannel;
        if (!channel) {
            this.showToast('No channel selected', 'warning');
            return;
        }

        try {
            this.isLoadingCancelled = false;
            this.showOverlay();
            this.showLoading(true);

            this.stopPlayback();
            await new Promise(resolve => setTimeout(resolve, 100));

            await this.loadStream(channel.url, channel);
            this.showLoading(false);
            this.hideOverlay();
            this.showToast('Stream reloaded', 'success');
        } catch (e) {
            console.error('Reload failed:', e);
            this.showLoading(false);
            this.showOverlay();
            this.showToast(`Reload failed: ${e.message}`, 'error');
        }
    }

    async copyActiveUrl() {
        const channel = this.getActiveChannel();
        if (!channel) return this.showToast('No stream selected', 'warning');

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(channel.url);
                this.showToast('Copied URL', 'success');
            } else {
                prompt('Copy stream URL:', channel.url);
            }
        } catch (e) {
            prompt('Copy stream URL:', channel.url);
        }
    }

    openActiveUrl() {
        const channel = this.getActiveChannel();
        if (!channel) return this.showToast('No stream selected', 'warning');
        window.open(channel.url, '_blank', 'noopener,noreferrer');
    }

    async togglePiP() {
        const video = this.getActiveVideoElement();
        if (!video) {
            this.showToast('No video element', 'warning');
            return;
        }

        console.log('togglePiP: attempting PiP on', video.id || 'unnamed video');

        try {
            // Ensure video is playing (required for PiP)
            if (video.paused) {
                try {
                    await video.play();
                    console.log('Video started playing');
                } catch (e) {
                    console.warn('Could not play video:', e.message);
                }
            }

            // iOS/iPadOS: Try webkit presentation mode with comprehensive support detection
            if (typeof video.webkitSetPresentationMode === 'function') {
                try {
                    // Check if we can support PiP by looking at the video state
                    const canSupportPiP = video.readyState >= 2 && video.networkState < 3;
                    console.log('Webkit PiP available, readyState:', video.readyState, 'networkState:', video.networkState, 'canSupport:', canSupportPiP);
                    
                    const current = video.webkitPresentationMode || 'inline';
                    console.log('Current webkit presentation mode:', current);
                    
                    if (current === 'picture-in-picture') {
                        video.webkitSetPresentationMode('inline');
                        console.log('✓ Exited webkit PiP');
                        this.showToast('Exited PiP', 'success');
                    } else {
                        video.webkitSetPresentationMode('picture-in-picture');
                        console.log('✓ Entered webkit PiP');
                        this.showToast('PiP enabled', 'success');
                    }
                    return;
                } catch (e) {
                    console.warn('Webkit PiP error:', e.name, e.message);
                    // Continue to standard API
                }
            }

            // Standard requestPictureInPicture API (desktop/modern browsers)
            if (document.pictureInPictureElement) {
                try {
                    await document.exitPictureInPicture();
                    console.log('✓ Exited standard PiP');
                    this.showToast('Exited PiP', 'success');
                    return;
                } catch (e) {
                    console.warn('Exit PiP error:', e.message);
                }
            }

            if (typeof video.requestPictureInPicture === 'function') {
                try {
                    console.log('Attempting standard requestPictureInPicture...');
                    await video.requestPictureInPicture();
                    console.log('✓ Entered standard PiP');
                    this.showToast('PiP enabled', 'success');
                    return;
                } catch (e) {
                    console.warn('Standard PiP error:', e.name, '-', e.message);
                    // Provide helpful guidance based on error
                    if (e.name === 'NotSupportedError') {
                        this.showToast('PiP: This browser/video format may not support PiP', 'warning');
                    } else if (e.name === 'InvalidStateError') {
                        this.showToast('PiP: Video not ready or already in PiP mode', 'warning');
                    } else {
                        this.showToast('PiP not available: ' + e.message, 'warning');
                    }
                    return;
                }
            }

            // No PiP API available
            console.warn('No PiP API found on this device');
            this.showToast('PiP not supported on this device/browser', 'warning');
        } catch (e) {
            console.warn('PiP error:', e);
            this.showToast('PiP failed: ' + (e.message || 'unknown error'), 'warning');
        }
    }

    async checkVisibleHealth() {
        if (!this.filteredChannels || this.filteredChannels.length === 0) {
            this.showToast('No channels to check', 'warning');
            return;
        }

        const targets = this.filteredChannels.slice(0, 30);
        this.showToast(`Checking ${targets.length} streams...`, 'info');

        try {
            const results = await this.streamValidator.validateBatch(targets.map(c => c.url), 5);
            const urlToChannelId = new Map(targets.map(c => [c.url, c.id]));

            for (const res of results) {
                const id = urlToChannelId.get(res.url);
                if (!id) continue;

                if (res.valid) {
                    this.channelHealth[id] = 'ok';
                } else {
                    this.channelHealth[id] = 'bad';
                }
            }

            this.applyFilters();
            this.showToast('Health check complete', 'success');
        } catch (e) {
            console.warn('Health check failed:', e);
            this.showToast('Health check failed', 'warning');
        }
    }

    setMultiviewAudioSlotExplicit(slotIndex) {
        if (!this.isMultiviewMode) return;
        this.activeMultiviewAudioSlot = slotIndex;
        this.applyMultiviewAudioState();
    }

    onMultiviewActionClick(event) {
        const btn = event.target?.closest?.('.mv-action');
        if (!btn) return;

        event.preventDefault();
        event.stopPropagation();

        const action = btn.getAttribute('data-action');
        const slot = parseInt(btn.getAttribute('data-slot'), 10);
        if (Number.isNaN(slot)) return;

        switch (action) {
            case 'playpause':
                {
                    const video = this.multiviewVideos[slot];
                    const overlay = this.multiviewOverlays[slot];
                    if (!video) break;
                    if (video.paused) {
                        video.play().then(() => {
                            if (overlay) overlay.classList.add('hidden');
                        }).catch((e) => {
                            console.warn('Multiview play failed:', e);
                        });
                    } else {
                        video.pause();
                        if (overlay) {
                            overlay.textContent = 'Paused';
                            overlay.classList.remove('hidden');
                        }
                    }
                }
                break;
            case 'clear':
                this.clearMultiviewSlot(slot);
                break;
            case 'reload':
                this.reloadMultiviewSlot(slot);
                break;
            case 'fullscreen':
                // Toggle fullscreen on/off
                if (this._fullscreenSlotIndex === slot) {
                    this.exitMultiviewSlotFullscreen();
                } else {
                    this.exitMultiviewSlotFullscreen(); // Exit any existing fullscreen first
                    this.fullscreenMultiviewSlot(slot);
                }
                break;
            case 'swap':
                this.swapMultiviewSlot(slot);
                break;
        }
    }

    clearMultiviewSlot(slotIndex) {
        if (slotIndex < 0 || slotIndex >= 4) return;

        if (this.multiviewPlayers[slotIndex]) {
            this.multiviewPlayers[slotIndex].destroy();
            this.multiviewPlayers[slotIndex] = null;
        }

        const video = this.multiviewVideos[slotIndex];
        video.pause();
        video.src = '';
        video.load();
        video.muted = true;

        this.multiviewChannels[slotIndex] = null;
        this.multiviewLabels[slotIndex].textContent = `Slot ${slotIndex + 1}`;
        this.multiviewOverlays[slotIndex].textContent = 'Click a channel to load';
        this.multiviewOverlays[slotIndex].classList.remove('hidden');

        if (this.activeMultiviewAudioSlot === slotIndex) {
            this.activeMultiviewAudioSlot = null;
            this.applyMultiviewAudioState();
        }

        this.showToast(`Slot ${slotIndex + 1} cleared`, 'success');
    }

    async reloadMultiviewSlot(slotIndex) {
        const ch = this.multiviewChannels[slotIndex];
        if (!ch) {
            this.showToast('Nothing to reload in this slot', 'warning');
            return;
        }
        await this.loadChannelIntoMultiviewSlot(ch, slotIndex);
        this.showToast(`Slot ${slotIndex + 1} reloaded`, 'success');
    }

    fullscreenMultiviewSlot(slotIndex) {
        const slot = this.multiviewSlots[slotIndex];
        const video = this.multiviewVideos[slotIndex];
        
        if (!slot || !video) {
            console.error('Slot or video not found:', slotIndex);
            this.showToast('Slot not found', 'warning');
            return;
        }

        // Check if we're in standalone web app mode
        const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
        this.sendDebugLog(`Fullscreen slot ${slotIndex} using native API, standalone: ${isStandalone}`);
        const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
        
        if (!isFullscreen) {
            if (slot && slot.requestFullscreen) {
                this.sendDebugLog(`Calling requestFullscreen on slot ${slotIndex}...`);
                slot.requestFullscreen().then(() => {
                    this.sendDebugLog(`Slot ${slotIndex} fullscreen SUCCESS`);
                    this._fullscreenSlotIndex = slotIndex;
                }).catch(err => {
                    this.sendDebugLog(`Slot ${slotIndex} fullscreen FAILED: ${err.message}`, 'ERROR');
                    // Fallback for standalone mode
                    if (isStandalone) {
                        this.enterFakeFullscreen(slot);
                        this._fullscreenSlotIndex = slotIndex;
                    }
                });
            } else if (slot && slot.webkitRequestFullscreen) {
                this.sendDebugLog(`Calling webkitRequestFullscreen on slot ${slotIndex}...`);
                slot.webkitRequestFullscreen();
                this._fullscreenSlotIndex = slotIndex;
                this.sendDebugLog(`Slot ${slotIndex} webkitRequestFullscreen SUCCESS`);
            } else if (isStandalone) {
                // Standalone mode fallback
                this.sendDebugLog(`Using fake fullscreen for slot ${slotIndex} in standalone mode`);
                this.enterFakeFullscreen(slot);
                this._fullscreenSlotIndex = slotIndex;
            } else {
                this.sendDebugLog('Slot fullscreen not available', 'ERROR');
            }
        }
    }

    exitMultiviewSlotFullscreen() {
        if (this._fullscreenSlotIndex === undefined) return;

        const slot = this.multiviewSlots[this._fullscreenSlotIndex];
        
        // Exit native fullscreen
        this.sendDebugLog('Exiting slot fullscreen...');
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
        
        // Also exit fake fullscreen if active
        if (slot && slot.classList.contains('fake-fullscreen')) {
            this.exitFakeFullscreen(slot);
        }

        this._fullscreenSlotIndex = undefined;
    }

    swapMultiviewSlot(slotIndex) {
        if (!this.isMultiviewMode) return;

        // first click sets pending slot
        if (this.swapPendingSlot === null) {
            this.swapPendingSlot = slotIndex;
            this.multiviewSlots[slotIndex].classList.add('swap-pending');
            this.showToast('Select another slot to swap', 'info');
            return;
        }

        // clicking same slot cancels
        if (this.swapPendingSlot === slotIndex) {
            this.multiviewSlots[slotIndex].classList.remove('swap-pending');
            this.swapPendingSlot = null;
            this.showToast('Swap cancelled', 'info');
            return;
        }

        // swap channels
        const a = this.swapPendingSlot;
        const b = slotIndex;

        this.multiviewSlots[a].classList.remove('swap-pending');
        this.swapPendingSlot = null;

        const chA = this.multiviewChannels[a];
        const chB = this.multiviewChannels[b];

        this.multiviewChannels[a] = chB;
        this.multiviewChannels[b] = chA;

        // swap audio selection
        if (this.activeMultiviewAudioSlot === a) this.activeMultiviewAudioSlot = b;
        else if (this.activeMultiviewAudioSlot === b) this.activeMultiviewAudioSlot = a;

        // reload slots to apply swap
        if (chB) this.loadChannelIntoMultiviewSlot(chB, a); else this.clearMultiviewSlot(a);
        if (chA) this.loadChannelIntoMultiviewSlot(chA, b); else this.clearMultiviewSlot(b);

        this.applyMultiviewAudioState();
        this.showToast('Slots swapped', 'success');
    }

    // ============ End helpers ============

    renderChannels() {
        console.log('Rendering channels:', this.filteredChannels.length);

        if (this.channelsMeta) {
            this.channelsMeta.textContent = `${this.filteredChannels.length} / ${this.channels.length}`;
        }

        if (!this.channelsList) {
            console.error('channelsList element not found!');
            return;
        }

        if (this.filteredChannels.length === 0) {
            this.channelsList.innerHTML = '<p class="empty-state">No channels match your filters</p>';
            return;
        }

        this.channelsList.innerHTML = '';

        this.filteredChannels.forEach(channel => {
            const channelItem = document.createElement('div');
            channelItem.className = 'channel-item';
            channelItem.dataset.channelId = channel.id;
            channelItem.tabIndex = 0;

            if (this.currentChannel && this.currentChannel.id === channel.id) {
                channelItem.classList.add('active');
            }

            const display = this.getChannelDisplay(channel);
            const isFav = this.favorites.has(channel.id);
            const health = this.channelHealth[channel.id];
            const healthClass = health === 'ok' ? 'ok' : health === 'warn' ? 'warn' : health === 'bad' ? 'bad' : '';

            const nowNext = this.getNowNextText(channel);

            channelItem.innerHTML = `
                <div class="channel-item-content">
                    <img class="channel-logo" src="${display.logoUrl}" alt="${this.escapeHtml(display.name)}" onerror="this.src='https://via.placeholder.com/60x40?text=No+Logo'">
                    <div class="channel-details">
                        <div class="channel-name">
                            <span class="channel-health-dot ${healthClass}"></span>${this.escapeHtml(display.name)}
                        </div>
                        <div class="channel-info">${this.escapeHtml(display.category)}</div>
                        ${nowNext ? `<div class="channel-epg">${nowNext}</div>` : ''}
                    </div>
                    <div class="channel-item-actions">
                        <button class="channel-action-btn ${isFav ? 'is-favorite' : ''}" data-action="favorite" title="Favorite">${isFav ? '★' : '☆'}</button>
                        <button class="channel-action-btn" data-action="edit" title="Edit">✎</button>
                    </div>
                </div>
            `;

            channelItem.addEventListener('click', (e) => {
                const action = e.target?.getAttribute?.('data-action');
                if (action === 'favorite') {
                    e.stopPropagation();
                    this.toggleFavorite(channel.id);
                    return;
                }
                if (action === 'edit') {
                    e.stopPropagation();
                    this.openEditChannelModal(channel.id);
                    return;
                }

                this.playChannel(channel);
            });

            channelItem.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.playChannel(channel);
                }
            });

            this.channelsList.appendChild(channelItem);
        });
    }

    async playChannel(channel) {
        // In multiview mode, load channel into the active slot instead of single player
        if (this.isMultiviewMode) {
            return this.loadChannelIntoMultiviewSlot(channel, this.activeMultiviewSlot);
        }

        if (this.currentChannel && this.currentChannel.id === channel.id) {
            return; // Already playing
        }

        this.addRecent(channel.id);
        this.saveLastWatchedChannel();

        // Reset cancel flag
        this.isLoadingCancelled = false;

        try {
            // Update UI
            this.setCurrentChannel(channel);
            // Ensure toolbar remains visible (prevent it being covered by video element)
            try { if (this.playerToolbar) this.playerToolbar.style.display = 'flex'; } catch (e) {}
            this.showOverlay();
            this.showLoading(true);
            this.updateBufferStatus('buffering');
            
            // Stop current playback
            this.stopPlayback();
            
            // Small delay to ensure cleanup
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Check if cancelled
            if (this.isLoadingCancelled) {
                this.showLoading(false);
                this.updateBufferStatus('error');
                return;
            }
            
            // Validate stream (non-blocking, don't wait too long)
            const validationPromise = this.streamValidator.validate(channel.url).catch(() => null);
            
            // Play stream (don't wait for validation)
            try {
                this.currentLoadPromise = this.loadStream(channel.url, channel);
                await this.currentLoadPromise;
                
                // Check if cancelled after loading
                if (this.isLoadingCancelled) {
                    this.stopPlayback();
                    this.showLoading(false);
                    this.updateBufferStatus('error');
                    return;
                }
                
                this.showLoading(false);
                this.updateBufferStatus('ready');
            } catch (streamError) {
                // Don't show error if user cancelled
                if (this.isLoadingCancelled) {
                    this.showLoading(false);
                    this.updateBufferStatus('error');
                    return;
                }
                
                this.updateBufferStatus('error');
                // Check validation result
                const validation = await validationPromise;
                if (validation && !validation.valid && validation.checked) {
                    this.showToast(`Stream error: ${validation.error || streamError.message}`, 'error');
                } else {
                    this.showToast(`Stream error: ${streamError.message}`, 'error');
                }
                this.showLoading(false);
                this.showOverlay();
            }
            
            // Start stream health monitor
            // DISABLED: Aggressive auto-recovery was interfering with normal stream loading/caching
            // this.startStreamHealthMonitor(channel, null);
            
        } catch (error) {
            // Don't show error if user cancelled
            if (this.isLoadingCancelled) {
                this.showLoading(false);
                this.updateBufferStatus('error');
                return;
            }
            
            console.error('Error playing channel:', error);
            this.updateBufferStatus('error');
            this.showToast(`Error playing channel: ${error.message}`, 'error');
            this.showLoading(false);
            this.showOverlay();
        } finally {
            this.currentLoadPromise = null;
        }
    }
    
    cancelLoading() {
        console.log('Loading cancelled by user');
        this.isLoadingCancelled = true;
        this.stopPlayback();
        this.showLoading(false);
        this.showOverlay();
        this.showToast('Loading cancelled', 'warning');
    }

    async loadStream(url, channel = null) {
        return new Promise((resolve, reject) => {
            let resolved = false;
            let timeoutId = null;
            let errorCount = 0;
            const maxRetries = 3;

            const cleanup = () => {
                if (timeoutId) clearTimeout(timeoutId);
            };

            const resolveOnce = () => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    resolve();
                }
            };

            const rejectOnce = (error) => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    reject(error);
                }
            };

            // Use mpegts.js for ALL streams - it handles MPEG-TS natively
            if (typeof mpegts !== 'undefined' && mpegts.getFeatureList().mseLivePlayback) {
                console.log('Using mpegts.js for MPEG-TS stream playback...');
                
                // Destroy previous player if exists
                if (this.mpegtsPlayer) {
                    this.mpegtsPlayer.destroy();
                    this.mpegtsPlayer = null;
                }
                
                const profile = this.getEffectiveProfileName(channel);
                const config = this.getMpegtsPlayerConfig(url, profile);

                // Create MPEG-TS player (default profile keeps the original settings unchanged)
                this.mpegtsPlayer = mpegts.createPlayer(config);
                
                // Attach to video element
                this.mpegtsPlayer.attachMediaElement(this.videoPlayer);
                
                // Load and play
                this.mpegtsPlayer.load();
                
                // Handle errors - with automatic recovery for SourceBuffer removed
                let _recoveryAttempted = false;
                this.mpegtsPlayer.on(mpegts.Events.ERROR, (errorType, errorDetail, errorInfo) => {
                    try {
                        const detailStr = (errorDetail && (errorDetail.msg || errorDetail.message || errorDetail.toString())) || '';
                        const infoStr = (errorInfo && (errorInfo.msg || errorInfo.message || errorInfo.toString())) || '';
                        const combined = `${detailStr} ${infoStr}`.toLowerCase();

                        // Specific recovery for SourceBuffer removed race (common in rapid reloads)
                        if (!_recoveryAttempted && (combined.includes('sourcebuffer') || combined.includes('removed from the parent media source'))) {
                            console.warn('Detected SourceBuffer removal; attempting automatic recovery...');
                            _recoveryAttempted = true;

                            try {
                                const savedUrl = url;
                                const savedProfile = profile;
                                const savedConfig = this.getMpegtsPlayerConfig(savedUrl, savedProfile);
                                const savedVideo = this.videoPlayer;

                                this.mpegtsPlayer.destroy();
                                this.mpegtsPlayer = null;

                                setTimeout(() => {
                                    try {
                                        this.mpegtsPlayer = mpegts.createPlayer(savedConfig);
                                        this.mpegtsPlayer.attachMediaElement(savedVideo);
                                        this.mpegtsPlayer.load();
                                        console.log('Recovery: player recreated and reloaded');
                                        // Attempt to play after recovery
                                        setTimeout(() => {
                                            savedVideo.play().catch(e => console.warn('Recovery playback start:', e));
                                        }, 500);
                                    } catch (e) {
                                        console.error('Recovery recreate failed:', e);
                                    }
                                }, 300);
                            } catch (e) {
                                console.error('Recovery attempt failed:', e);
                            }
                            return;
                        }

                        if (errorType === mpegts.ErrorTypes.NETWORK_ERROR) {
                            console.warn('Network issue (stream may still work):', errorDetail);
                        } else if (errorType === mpegts.ErrorTypes.MEDIA_ERROR) {
                            console.warn('Media issue (stream may still work):', errorDetail);
                        } else {
                            console.warn('MPEG-TS warning:', errorDetail);
                        }
                    } catch (e) {
                        console.warn('Error in error handler:', e);
                    }
                });
                
                // Play when ready
                setTimeout(() => {
                    this.videoPlayer.play().then(() => {
                        console.log('MPEG-TS playback started successfully!');
                        resolveOnce();
                    }).catch(err => {
                        console.warn('Autoplay failed, but stream is ready:', err);
                        this.videoPlayer.muted = false;
                        this.videoPlayer.play().then(() => {
                            resolveOnce();
                        }).catch(() => {
                            resolveOnce(); // Stream is ready even if autoplay fails
                        });
                    });
                }, 200);
            } else {
                rejectOnce(new Error('MPEG-TS playback not supported - MSE Live Playback required'));
            }
        });
    }

    // OLD FUNCTION - REMOVED - Now using mpegts.js directly
    _old_tryMPEGTSDirect(url, resolveOnce, rejectOnce) {
        // For direct MPEG-TS streams, try multiple approaches:
        // 1. First, try the URL as-is (might be HLS endpoint that serves TS)
        // 2. If that fails, wrap it in an HLS playlist structure
        
        console.log('MPEG-TS stream detected, trying multiple playback methods...');
        
        let attempts = 0;
        const maxAttempts = 2;
        
        const tryAsHLS = () => {
            attempts++;
            console.log(`Attempt ${attempts}: Trying URL as HLS endpoint...`);
            
            if (this.hls) {
                this.hls.destroy();
            }
            
            this.hls = new Hls({
                enableWorker: true,
                debug: true,
                maxFragLoadingTimeOut: 30000,
                fragLoadingTimeOut: 30000,
                manifestLoadingTimeOut: 20000,
                xhrSetup: (xhr, segmentUrl) => {
                    xhr.withCredentials = false;
                    xhr.timeout = 30000;
                    xhr.setRequestHeader('Accept', 'video/mp2t, application/vnd.apple.mpegurl, */*');
                }
            });
            
            this.hls.loadSource(url);
            this.hls.attachMedia(this.videoPlayer);
            
            this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                console.log('MPEG-TS stream loaded as HLS, starting playback...');
                setTimeout(() => {
                    this.videoPlayer.play().then(() => {
                        console.log('MPEG-TS playback started successfully!');
                        resolveOnce();
                    }).catch(() => {
                        console.log('MPEG-TS stream ready (autoplay blocked)');
                        resolveOnce();
                    });
                }, 200);
            });
            
            this.hls.on(Hls.Events.ERROR, (event, data) => {
                console.error('HLS error for MPEG-TS:', data.type, data.details);
                
                if (data.fatal) {
                    if (attempts < maxAttempts && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                        // Try wrapping in HLS playlist
                        console.log('Trying to wrap MPEG-TS in HLS playlist...');
                        this.hls.destroy();
                        this.tryWrappedMPEGTS(url, resolveOnce, rejectOnce);
                    } else {
                        rejectOnce(new Error(`MPEG-TS stream error: ${data.details || data.type}`));
                    }
                }
            });
        };
        
        // Start with trying as HLS
        tryAsHLS();
    }
    
    tryWrappedMPEGTS(url, resolveOnce, rejectOnce) {
        // Wrap direct MPEG-TS in HLS playlist structure
        // This works for single TS files, not live streams
        console.log('Wrapping MPEG-TS in HLS playlist structure...');
        
        const m3u8Content = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:10.0,
${url}
#EXT-X-ENDLIST`;

        const blob = new Blob([m3u8Content], { type: 'application/vnd.apple.mpegurl' });
        const blobUrl = URL.createObjectURL(blob);
        
        this.hls = new Hls({
            enableWorker: true,
            debug: true,
            xhrSetup: (xhr, segmentUrl) => {
                xhr.withCredentials = false;
                xhr.timeout = 30000;
                xhr.setRequestHeader('Accept', 'video/mp2t, */*');
            }
        });
        
        this.hls.loadSource(blobUrl);
        this.hls.attachMedia(this.videoPlayer);
        
        this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
            console.log('Wrapped MPEG-TS playlist parsed');
            setTimeout(() => {
                this.videoPlayer.play().then(() => {
                    resolveOnce();
                    URL.revokeObjectURL(blobUrl);
                }).catch(() => {
                    resolveOnce();
                    URL.revokeObjectURL(blobUrl);
                });
            }, 200);
        });
        
        this.hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                URL.revokeObjectURL(blobUrl);
                rejectOnce(new Error('MPEG-TS stream format not supported - may need to be served as HLS playlist'));
            }
        });
    }

    tryNativePlayback(url, resolveOnce, rejectOnce) {
        // Clear any previous source
        this.videoPlayer.src = '';
        this.videoPlayer.load();
        
        // Set source - browser will try to play it natively
        this.videoPlayer.src = url;
        
        const onCanPlay = () => {
            console.log('Video can play, starting playback...');
            this.videoPlayer.play().then(() => {
                resolveOnce();
            }).catch(err => {
                console.warn('Autoplay failed, but stream is ready:', err);
                // Try unmuting and playing again
                this.videoPlayer.muted = false;
                this.videoPlayer.play().then(() => {
                    resolveOnce();
                }).catch(() => {
                    // Stream is ready even if autoplay fails
                    resolveOnce();
                });
            });
        };

        const onLoadedMetadata = () => {
            console.log('Video metadata loaded');
            // Also try to play when metadata is loaded
            if (this.videoPlayer.readyState >= 2) {
                onCanPlay();
            }
        };

        const onError = (e) => {
            const error = this.videoPlayer.error;
            let errorMsg = 'Failed to load video stream';
            if (error) {
                switch (error.code) {
                    case error.MEDIA_ERR_ABORTED:
                        errorMsg = 'Video playback aborted';
                        break;
                    case error.MEDIA_ERR_NETWORK:
                        errorMsg = 'Network error loading stream';
                        break;
                    case error.MEDIA_ERR_DECODE:
                        errorMsg = 'Video decode error - format may not be supported by browser';
                        break;
                    case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                        errorMsg = 'Video format not supported - MPEG-TS may require server-side transcoding';
                        break;
                }
            }
            console.error('Video error:', errorMsg, error);
            rejectOnce(new Error(errorMsg));
        };

        // Remove any existing listeners first
        this.videoPlayer.removeEventListener('canplay', onCanPlay);
        this.videoPlayer.removeEventListener('loadedmetadata', onLoadedMetadata);
        this.videoPlayer.removeEventListener('error', onError);

        // Add new listeners
        this.videoPlayer.addEventListener('canplay', onCanPlay, { once: true });
        this.videoPlayer.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
        this.videoPlayer.addEventListener('error', onError, { once: true });
        
        // Force load
        this.videoPlayer.load();
    }

    stopPlayback() {
        // Stop stream health monitoring for single view
        this.stopStreamHealthMonitor('single');
        
        if (this.mpegtsPlayer) {
            this.mpegtsPlayer.destroy();
            this.mpegtsPlayer = null;
        }
        this.videoPlayer.pause();
        this.videoPlayer.src = '';
        this.videoPlayer.load();
    }
    
    // ============ Multiview Functions ============
    
    toggleMultiview() {
        this.isMultiviewMode = !this.isMultiviewMode;

        if (this.isMultiviewMode) {
            // Exit fullscreen-layout to show sidebar for channel selection
            if (document.body.classList.contains('is-fullscreen-layout')) {
                this.toggleFullscreenLayout();
                this.showToast('Exited fullscreen to access channels', 'info');
            }

            // Switch to multiview
            if (this.playerWrapper) this.playerWrapper.style.display = 'none';
            if (this.multiViewGrid) this.multiViewGrid.style.display = 'grid';
            if (this.toggleMultiviewBtn) {
                this.toggleMultiviewBtn.textContent = 'Exit Multiview';
                this.toggleMultiviewBtn.classList.add('active');
            }

            // Show exit multiview button in HUD
            const exitBtn = document.getElementById('videoExitMultiviewBtn');
            if (exitBtn) exitBtn.style.display = 'inline-block';

            // Save previous single-player state so we can restore it when exiting multiview
            try {
                this._preMultiview = {
                    channel: this.currentChannel || null,
                    wasPlaying: !!(this.videoPlayer && !this.videoPlayer.paused)
                };
            } catch (e) { this._preMultiview = null; }

            // Start in "mute all" until user picks an audio slot
            this.activeMultiviewAudioSlot = null;
            this.applyMultiviewAudioState();

            // Show exit button in sidebar if available
            try { if (this.exitMultiviewSidebarBtn) this.exitMultiviewSidebarBtn.style.display = 'inline-block'; } catch (e) {}

            // Stop single player
            this.stopPlayback();

            // Mark first slot as active by default
            this.selectMultiviewSlot(0);

            this.showToast('Multiview enabled. Pick a slot audio (🔇/🔊), then select channels.', 'success');
        } else {
            // Switch to single view
            if (this.multiViewGrid) this.multiViewGrid.style.display = 'none';
            if (this.playerWrapper) this.playerWrapper.style.display = 'block';
            if (this.toggleMultiviewBtn) {
                this.toggleMultiviewBtn.textContent = 'Multiview (4)';
                this.toggleMultiviewBtn.classList.remove('active');
            }

            // Hide exit multiview button in HUD
            const exitBtn = document.getElementById('videoExitMultiviewBtn');
            if (exitBtn) exitBtn.style.display = 'none';

            // Stop all multiview players
            this.stopAllMultiviewPlayers();

            // Hide sidebar exit button
            try { if (this.exitMultiviewSidebarBtn) this.exitMultiviewSidebarBtn.style.display = 'none'; } catch (e) {}

            // If a channel was playing before entering multiview, resume it now
            try {
                if (this._preMultiview && this._preMultiview.channel && this._preMultiview.wasPlaying) {
                    const prev = this._preMultiview.channel;
                    // Clear pre state before playing to avoid loops
                    this._preMultiview = null;
                    // Play the previous channel and attempt to resume
                    this.playChannel(prev);
                } else {
                    this._preMultiview = null;
                }
            } catch (e) {
                this._preMultiview = null;
            }

            this.showToast('Single view mode restored', 'success');
        }

        // Keep toolbar visible after toggling multiview
        try { if (this.playerToolbar) this.playerToolbar.style.display = 'flex'; } catch (e) {}
    }

    exitMultiview() {
        if (this.isMultiviewMode) {
            this.toggleMultiview();
        }
    }

    // ==================== RECORDING METHODS ====================
    
    toggleRecording() {
        if (!this.currentChannel) {
            this.showToast('No channel selected', 'error');
            return;
        }
        
        if (this.isRecording) {
            this.stopRecording();
        } else {
            this.startRecording();
        }
    }

    startRecording() {
        if (this.isRecording) return;
        
        this.isRecording = true;
        this.recordingStartTime = new Date();
        
        // Update button appearance - red indicator
        const recordBtn = document.getElementById('videoRecordBtn');
        if (recordBtn) {
            recordBtn.classList.add('active');
            recordBtn.style.backgroundColor = '#f44336';
        }
        
        const channelName = this.currentChannel.name || 'Unknown';
        this.showToast(`Recording "${channelName}" started...`, 'success');
        
        // Send start recording request to server
        const data = {
            channel: channelName,
            url: this.currentChannel.url,
            startTime: this.recordingStartTime.toISOString()
        };
        
        console.log('[RECORD] Sending start request:', data);
        fetch('/recording/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        }).then(r => {
            console.log('[RECORD] Start response status:', r.status);
            return r.json();
        }).then(res => {
            console.log('[RECORD] Start response:', res);
            if (res.success) {
                console.log('Recording started on server:', res.recordingId);
            } else {
                this.isRecording = false;
                recordBtn.classList.remove('active');
                recordBtn.style.backgroundColor = '';
                this.showToast('Failed to start recording: ' + (res.error || 'Unknown error'), 'error');

            }
        }).catch(err => {
            console.error('Recording start error:', err);
            this.isRecording = false;
            recordBtn.classList.remove('active');
            recordBtn.style.backgroundColor = '';
            this.showToast('Recording error: ' + err.message, 'error');
        });
    }

    stopRecording() {
        if (!this.isRecording) return;
        
        // Calculate duration BEFORE clearing the start time
        const duration = Math.round((new Date() - this.recordingStartTime) / 1000) || 0;
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        
        // Stop immediately on UI
        this.isRecording = false;
        this.recordingStartTime = null;
        
        const recordBtn = document.getElementById('videoRecordBtn');
        if (recordBtn) {
            recordBtn.classList.remove('active');
            recordBtn.style.backgroundColor = '';
        }
        
        this.showToast(`Recording stopped (${minutes}m ${seconds}s)`, 'success');
        
        // Send stop recording request to server
        const stopData = {
            channel: this.currentChannel.name,
            stopTime: new Date().toISOString(),
            duration: duration
        };
        console.log('[RECORD] Sending stop request:', stopData);
        fetch('/recording/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(stopData)
        }).then(r => {
            console.log('[RECORD] Stop response status:', r.status);
            return r.json();
        }).then(res => {
            console.log('[RECORD] Stop response:', res);
            if (res.success) {
                console.log('Recording stopped on server');
                // Refresh recordings list
                this.loadRecordings();
            }
        }).catch(err => {
            console.error('Recording stop error:', err);
        });
    }

    loadRecordings() {
        console.log('[RECORD] Loading recordings...');
        fetch('/recording/list')
            .then(r => {
                console.log('[RECORD] List response status:', r.status);
                return r.json();
            })
            .then(data => {
                console.log('[RECORD] List response:', data);
                this.recordings = data.recordings || [];
                console.log('[RECORD] Loaded', this.recordings.length, 'recordings');
            })
            .catch(err => console.error('Failed to load recordings:', err));
    }

    showRecordingsModal() {
        // Remove any existing recordings modal first
        const existingModal = document.getElementById('recordingsModal');
        if (existingModal) existingModal.remove();
        
        console.log('[RECORD] Opening recordings modal');
        // Load recordings first
        fetch('/recording/list')
            .then(r => {
                console.log('[RECORD] Modal list response status:', r.status);
                return r.json();
            })
            .then(data => {
                console.log('[RECORD] Modal list response:', data);
                console.log('[RECORD] Response type:', typeof data);
                console.log('[RECORD] recordings property:', data.recordings);
                console.log('[RECORD] recordings is array:', Array.isArray(data.recordings));
                if (data.recordings) {
                    console.log('[RECORD] recordings length:', data.recordings.length);
                    data.recordings.forEach((rec, i) => {
                        console.log(`[RECORD] Recording ${i}:`, rec);
                    });
                }
                this.recordings = data.recordings || [];
                console.log('[RECORD] After assignment, this.recordings.length:', this.recordings.length);
                this._displayRecordingsModal();
            })
            .catch(err => {
                console.error('[RECORD] Modal load error:', err);
                this.showToast('Failed to load recordings: ' + err.message, 'error');
            });
    }

    _displayRecordingsModal() {
        const modal = document.createElement('div');
        modal.id = 'recordingsModal';
        modal.className = 'modal open';  // Add 'open' class to make it visible
        
        let recordingsHTML = `
            <div class="modal-backdrop"></div>
            <div class="modal-card">
                <div class="modal-header">
                    <h2>📹 Recordings</h2>
                    <button class="modal-close" onclick="document.getElementById('recordingsModal').remove()">✕</button>
                </div>
                <div class="modal-body">
        `;
        
        if (this.recordings.length === 0) {
            recordingsHTML += '<p class="empty-state">No recordings yet. Start recording a stream to save clips!</p>';
        } else {
            recordingsHTML += '<div class="recordings-list">';
            this.recordings.forEach(rec => {
                const date = new Date(rec.timestamp * 1000);
                const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
                const sizeStr = (rec.size / (1024*1024)).toFixed(2) + ' MB';
                const durationStr = this._formatDuration(rec.duration);
                
                // Disable play button for very small files (likely incomplete)
                const isIncomplete = rec.size < 1024 * 100;  // Less than 100KB
                const playButtonDisabled = isIncomplete ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : '';
                const playTooltip = isIncomplete ? ' title="Recording still in progress or too small"' : '';
                
                recordingsHTML += `
                    <div class="recording-item">
                        <div class="recording-info">
                            <div class="recording-title">${rec.channel}</div>
                            <div class="recording-meta">
                                <span>${dateStr}</span>
                                <span>${durationStr}</span>
                                <span>${sizeStr}</span>
                            </div>
                        </div>
                        <div class="recording-actions">
                            <button class="btn-secondary" ${playButtonDisabled} onclick="app.playRecording('${rec.filename}')${playTooltip}">▶ Play</button>
                            <button class="btn-secondary" onclick="app.deleteRecording('${rec.filename}')">🗑️ Delete</button>
                        </div>
                    </div>
                `;
            });
            recordingsHTML += '</div>';
        }
        
        recordingsHTML += `
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="app.showScheduleRecordingModal()">⏱️ Schedule</button>
                    <button class="btn-secondary" onclick="document.getElementById('recordingsModal').remove()">Close</button>
                </div>
            </div>
        `;
        
        modal.innerHTML = recordingsHTML;
        document.body.appendChild(modal);
    }

    playRecording(filename) {
        // Remove any existing player modal first
        const existingPlayerModal = document.getElementById('recordingPlayerModal');
        if (existingPlayerModal) existingPlayerModal.remove();
        
        const recordingUrl = `/recording/play?file=${encodeURIComponent(filename)}`;
        
        // Create a new modal for playing the recording
        const playerModal = document.createElement('div');
        playerModal.id = 'recordingPlayerModal';
        playerModal.className = 'modal open';
        
        const html = `
            <div class="modal-backdrop" onclick="document.getElementById('recordingPlayerModal').remove()"></div>
            <div class="modal-card" style="max-width: 90%; height: 90%; display: flex; flex-direction: column;">
                <div class="modal-header">
                    <h2>📹 Playing: ${filename}</h2>
                    <button class="modal-close" onclick="document.getElementById('recordingPlayerModal').remove()">✕</button>
                </div>
                <div class="modal-body" style="flex: 1; display: flex; align-items: center; justify-content: center; background: #000;">
                    <div id="recordingPlayerContainer" style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
                        <p style="color: #fff;">Loading recording...</p>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="document.getElementById('recordingPlayerModal').remove()">Close</button>
                </div>
            </div>
        `;
        
        playerModal.innerHTML = html;
        document.body.appendChild(playerModal);
        
        // Use mpegts.js to play the recording (handles MPEG-TS format properly)
        setTimeout(() => {
            const container = document.getElementById('recordingPlayerContainer');
            if (!container) return;
            
            if (window.mpegts) {
                try {
                    // Create video element
                    const video = document.createElement('video');
                    video.style.width = '100%';
                    video.style.height = '100%';
                    video.style.objectFit = 'contain';
                    video.controls = true;
                    
                    container.innerHTML = '';
                    container.appendChild(video);
                    
                    const player = window.mpegts.createPlayer({
                        type: 'mse',
                        isLive: false,
                        url: recordingUrl
                    });
                    
                    player.attachMediaElement(video);
                    player.load();
                    player.play();
                    
                    console.log('[RECORD] Playing with mpegts.js');
                    this.showToast('Playing recording...', 'success');
                    
                    // Cleanup on modal close
                    const checkClose = setInterval(() => {
                        if (!document.getElementById('recordingPlayerModal')) {
                            clearInterval(checkClose);
                            if (player) {
                                player.destroy();
                            }
                        }
                    }, 100);
                } catch (e) {
                    console.error('[RECORD] mpegts error:', e);
                    container.innerHTML = `<p style="color: red;">Error: ${e.message}</p>`;
                    this.showToast('Error playing recording: ' + e.message, 'error');
                }
            } else {
                container.innerHTML = '<p style="color: red;">Player library not loaded</p>';
                this.showToast('Player library not available', 'error');
            }
        }, 100);
    }

    deleteRecording(filename) {
        if (!confirm('Delete this recording?')) return;
        
        fetch('/recording/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: filename })
        }).then(r => r.json()).then(res => {
            if (res.success) {
                this.showToast('Recording deleted', 'success');
                this.loadRecordings();
                this.showRecordingsModal();
            } else {
                this.showToast('Failed to delete: ' + (res.error || 'Unknown error'), 'error');
            }
        }).catch(err => {
            this.showToast('Delete error: ' + err.message, 'error');
        });
    }

    _formatDuration(seconds) {
        if (!seconds) return '0s';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        if (hours > 0) return `${hours}h ${minutes}m`;
        if (minutes > 0) return `${minutes}m ${secs}s`;
        return `${secs}s`;
    }

    showScheduleRecordingModal() {
        // Remove any existing schedule modal first
        const existingModal = document.getElementById('scheduleModal');
        if (existingModal) existingModal.remove();
        
        const modal = document.createElement('div');
        modal.id = 'scheduleModal';
        modal.className = 'modal open';
        
        // Get current time and add 1 hour as default
        const now = new Date();
        const scheduledTime = new Date(now.getTime() + 3600000);
        const dateStr = scheduledTime.toISOString().slice(0, 16);
        
        // Build channel select options
        let channelOptions = '<option value="">Select channel...</option>';
        this.channels.forEach(ch => {
            channelOptions += `<option value="${ch.url}">${ch.name}</option>`;
        });
        
        const html = `
            <div class="modal-backdrop"></div>
            <div class="modal-card">
                <div class="modal-header">
                    <h2>⏱️ Schedule Recording</h2>
                    <button class="modal-close" onclick="document.getElementById('scheduleModal').remove()">✕</button>
                </div>
                <div class="modal-body">
                    <div class="form-row">
                        <label for="scheduleChannel">Channel:</label>
                        <select id="scheduleChannel" style="padding: 8px; border-radius: 8px; border: 1px solid var(--border-color); background: rgba(255,255,255,0.06); color: var(--text-primary);">
                            ${channelOptions}
                        </select>
                    </div>
                    <div class="form-row">
                        <label for="scheduleStartTime">Start Time:</label>
                        <input type="datetime-local" id="scheduleStartTime" value="${dateStr}" style="padding: 8px; border-radius: 8px; border: 1px solid var(--border-color); background: rgba(255,255,255,0.06); color: var(--text-primary);">
                    </div>
                    <div class="form-row">
                        <label for="scheduleDuration">Duration (minutes):</label>
                        <input type="number" id="scheduleDuration" value="60" min="5" max="600" style="padding: 8px; border-radius: 8px; border: 1px solid var(--border-color); background: rgba(255,255,255,0.06); color: var(--text-primary);">
                    </div>
                    <p class="help-text">The recording will start at the specified time and continue for the specified duration.</p>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="document.getElementById('scheduleModal').remove()">Cancel</button>
                    <button class="btn-primary" onclick="app.confirmScheduleRecording()">Schedule</button>
                </div>
            </div>
        `;
        
        modal.innerHTML = html;
        document.body.appendChild(modal);
    }

    confirmScheduleRecording() {
        const channelUrl = document.getElementById('scheduleChannel').value;
        const startTime = document.getElementById('scheduleStartTime').value;
        const duration = parseInt(document.getElementById('scheduleDuration').value);
        
        if (!channelUrl) {
            this.showToast('Please select a channel', 'error');
            return;
        }
        
        if (!startTime) {
            this.showToast('Please select a start time', 'error');
            return;
        }
        
        // Find the channel object
        const channel = this.channels.find(ch => ch.url === channelUrl);
        if (!channel) {
            this.showToast('Channel not found', 'error');
            return;
        }
        
        // Schedule the recording
        const scheduledAt = new Date(startTime).getTime();
        const now = Date.now();
        
        if (scheduledAt <= now) {
            this.showToast('Please select a future time', 'error');
            return;
        }
        
        // Calculate delay until recording should start
        const delay = scheduledAt - now;
        
        // Store scheduled recording
        const scheduleId = `sched_${Date.now()}`;
        this.scheduledRecordings.push({
            id: scheduleId,
            channel: channel.name,
            channelUrl: channelUrl,
            startTime: scheduledAt,
            duration: duration * 60,
            scheduled: true
        });
        
        // Schedule the recording to start at the specified time
        setTimeout(() => {
            if (this.scheduledRecordings.find(s => s.id === scheduleId)) {
                // Load the channel
                this.currentChannel = channel;
                this.loadStream(channel.url, channel.name);
                
                // Start recording
                this.isRecording = false; // Reset state
                this.startRecording();
                
                this.showToast(`Scheduled recording started for "${channel.name}"`, 'success');
            }
        }, delay);
        
        // Schedule stop
        setTimeout(() => {
            if (this.isRecording && this.scheduledRecordings.find(s => s.id === scheduleId)) {
                this.stopRecording();
                this.showToast(`Scheduled recording ended for "${channel.name}"`, 'success');
            }
            this.scheduledRecordings = this.scheduledRecordings.filter(s => s.id !== scheduleId);
        }, delay + (duration * 60 * 1000));
        
        this.showToast(`Recording scheduled for "${channel.name}" at ${new Date(scheduledAt).toLocaleString()}`, 'success');
        
        // Close modals
        document.getElementById('scheduleModal')?.remove();
        document.getElementById('recordingsModal')?.remove();
    }

    toggleCaptions() {
        // Toggle captions flag
        if (this.videoPlayer.textTracks.length > 0) {
            const firstTrack = this.videoPlayer.textTracks[0];
            if (firstTrack.mode === 'showing') {
                firstTrack.mode = 'hidden';
            } else {
                firstTrack.mode = 'showing';
            }
        }
        
        // Update button state
        this.updateCaptionButtonState();
        
        const captionState = (this.videoPlayer.textTracks.length > 0 && this.videoPlayer.textTracks[0].mode === 'showing') ? 'enabled' : 'disabled';
        this.showToast(`Captions ${captionState}`, 'success');
    }

    updateCaptionButtonState() {
        const captionsBtn = document.getElementById('videoCaptionsBtn');
        if (captionsBtn) {
            const isCaptionsOn = this.videoPlayer.textTracks.length > 0 && this.videoPlayer.textTracks[0].mode === 'showing';
            captionsBtn.classList.toggle('active', isCaptionsOn);
        }
    }

    
    
    selectMultiviewSlot(index) {
        if (!this.isMultiviewMode) return;
        
        this.activeMultiviewSlot = index;
        
        // Highlight active slot
        this.multiviewSlots.forEach((slot, i) => {
            if (i === index) {
                slot.classList.add('active');
            } else {
                slot.classList.remove('active');
            }
        });

        // Tie EPG + channel highlight to the active slot
        const channel = this.multiviewChannels[index];
        if (channel) {
            this.setCurrentChannel(channel);
        }
    }
    
    async loadChannelIntoMultiviewSlot(channel, slotIndex) {
        if (slotIndex < 0 || slotIndex >= 4) return;

        this.addRecent(channel.id);
        
        const video = this.multiviewVideos[slotIndex];
        const overlay = this.multiviewOverlays[slotIndex];
        const label = this.multiviewLabels[slotIndex];

        // Ensure muted defaults until user explicitly selects audio
        video.muted = true;
        
        // Destroy existing player if any
        if (this.multiviewPlayers[slotIndex]) {
            this.multiviewPlayers[slotIndex].destroy();
            this.multiviewPlayers[slotIndex] = null;
        }
        
        // Store channel
        this.multiviewChannels[slotIndex] = channel;

        // Keep app "current channel" aligned with the active slot (for EPG + keyboard navigation)
        this.setCurrentChannel(channel);
        // Ensure toolbar remains visible in multiview
        try { if (this.playerToolbar) this.playerToolbar.style.display = 'flex'; } catch (e) {}
        
        // Update label
        label.textContent = channel.name;
        
        // Show overlay
        overlay.textContent = 'Loading...';
        overlay.classList.remove('hidden');
        
        try {
            // Create new mpegts.js player for this slot (same config as single player)
            if (typeof mpegts !== 'undefined' && mpegts.getFeatureList().mseLivePlayback) {
                const profile = this.getEffectiveProfileName(channel);
                const config = this.getMpegtsPlayerConfig(channel.url, profile);
                const player = mpegts.createPlayer(config);
                
                player.attachMediaElement(video);
                player.load();
                
                // Suppress non-critical errors
                player.on(mpegts.Events.ERROR, (errorType, errorDetail) => {
                    console.warn(`Multiview slot ${slotIndex} warning:`, errorDetail);
                });
                
                this.multiviewPlayers[slotIndex] = player;
                
                // Play when ready
                setTimeout(() => {
                    video.play().then(() => {
                                overlay.classList.add('hidden');
                                this.applyMultiviewAudioState();
                    }).catch(() => {
                        // Muted, so autoplay should work; if not, hide anyway
                                overlay.classList.add('hidden');
                                this.applyMultiviewAudioState();
                    });
                }, 200);
            } else {
                throw new Error('MPEG-TS not supported');
            }
            
            // Start stream health monitor for this slot
            // DISABLED: Aggressive auto-recovery was interfering with normal stream loading/caching
            // this.startStreamHealthMonitor(channel, slotIndex);
            
        } catch (error) {
            console.error(`Error loading channel into multiview slot ${slotIndex}:`, error);
            overlay.textContent = 'Error loading stream';
        }
    }
    
    stopAllMultiviewPlayers() {
        this.activeMultiviewAudioSlot = null;

        // Stop all stream health monitors
        for (let i = 0; i < 4; i++) {
            this.stopStreamHealthMonitor(`slot-${i}`);
        }

        for (let i = 0; i < 4; i++) {
            if (this.multiviewPlayers[i]) {
                this.multiviewPlayers[i].destroy();
                this.multiviewPlayers[i] = null;
            }
            const video = this.multiviewVideos[i];
            video.pause();
            video.src = '';
            video.load();
            video.muted = true;
            
            this.multiviewChannels[i] = null;
            this.multiviewLabels[i].textContent = `Slot ${i + 1}`;
            this.multiviewOverlays[i].textContent = 'Click a channel to load';
            this.multiviewOverlays[i].classList.remove('hidden');
        }

        this.applyMultiviewAudioState();
    }
    
    setMultiviewAudioSlot(slotIndex) {
        if (!this.isMultiviewMode) return;

        // Toggle behavior: click same slot again => mute all
        if (this.activeMultiviewAudioSlot === slotIndex) {
            this.activeMultiviewAudioSlot = null;
        } else {
            this.activeMultiviewAudioSlot = slotIndex;
        }

        this.applyMultiviewAudioState();

        if (this.activeMultiviewAudioSlot === null) {
            this.showToast('Multiview audio muted', 'info');
        } else {
            const ch = this.multiviewChannels[this.activeMultiviewAudioSlot];
            this.showToast(`Audio: ${ch ? ch.name : `Slot ${this.activeMultiviewAudioSlot + 1}`}`, 'success');
        }
    }

    applyMultiviewAudioState() {
        if (!this.multiviewVideos || this.multiviewVideos.length !== 4) return;

        for (let i = 0; i < 4; i++) {
            const isActive = this.activeMultiviewAudioSlot === i;
            const video = this.multiviewVideos[i];
            const btn = this.multiviewAudioButtons?.[i];

            // Only unmute one slot at a time
            video.muted = !isActive;

            if (btn) {
                btn.textContent = isActive ? '🔊' : '🔇';
                btn.classList.toggle('is-audio-active', isActive);
            }
        }
    }

    toggleFullscreenLayout() {
        document.body.classList.toggle('is-fullscreen-layout');
        
        if (document.body.classList.contains('is-fullscreen-layout')) {
            this.fullscreenLayoutBtn.textContent = 'Exit Fullscreen Layout';
            this.showToast('Fullscreen layout enabled', 'success');
        } else {
            this.fullscreenLayoutBtn.textContent = 'Fullscreen Layout';
            this.showToast('Fullscreen layout disabled', 'success');
        }
    }

    setCurrentChannel(channel) {
        this.currentChannel = channel;

        const display = this.getChannelDisplay(channel);
        this.currentChannelName.textContent = display.name;
        this.currentChannelInfo.textContent = `${display.category || 'Uncategorized'} • ${channel.streamType || 'Stream'}`;

        // Update now playing header
        if (this.nowPlayingTitle) this.nowPlayingTitle.textContent = display.name;
        if (this.nowPlayingSub) {
            const nowNext = this.getNowNextPlain(channel);
            this.nowPlayingSub.textContent = nowNext || `${display.category || 'Uncategorized'} • ${channel.streamType || 'Stream'}`;
        }

        // Update channel list highlighting
        document.querySelectorAll('.channel-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.channelId === channel.id) {
                item.classList.add('active');
            }
        });

        // Update EPG
        this.updateEPGDisplay(channel);
    }

    updateEPGDisplay(channel) {
        if (!this.epgData) {
            this.epgContent.innerHTML = '<p class="empty-state">No EPG data available</p>';
            return;
        }

        let programs = null;
        
        // Try aligned programs first
        if (this.epgData.aligned) {
            programs = this.epgData.aligned.get(channel.id);
        }
        
        // If no aligned programs, try direct lookup by tvg-id
        if (!programs || programs.length === 0) {
            if (channel.tvgId && this.epgData.programs) {
                programs = this.epgData.programs[channel.tvgId] || [];
            }
        }
        
        // If still nothing, try fuzzy name matching
        if ((!programs || programs.length === 0) && channel.name && this.epgData.programs) {
            const matchedChannel = this.epgParser.findChannelByName(channel.name);
            if (matchedChannel) {
                programs = this.epgData.programs[matchedChannel.id] || [];
            }
        }
        
        if (!programs || programs.length === 0) {
            this.epgContent.innerHTML = '<p class="empty-state">No EPG programs found for this channel</p>';
            return;
        }

        const now = Date.now();
        const upcomingPrograms = programs
            .filter(prog => prog.stop >= now)
            .slice(0, 10);

        if (upcomingPrograms.length === 0) {
            this.epgContent.innerHTML = '<p class="empty-state">No upcoming programs</p>';
            return;
        }

        this.epgContent.innerHTML = upcomingPrograms.map(prog => {
            const startTime = this.epgParser.formatProgramTime(prog.start);
            const endTime = this.epgParser.formatProgramTime(prog.stop);
            const duration = this.epgParser.getProgramDuration(prog);
            const isCurrent = prog.start <= now && prog.stop >= now;
            
            return `
                <div class="epg-program ${isCurrent ? 'current' : ''}">
                    <div class="epg-program-time">${startTime} - ${endTime} (${duration} min)</div>
                    <div class="epg-program-title">${this.escapeHtml(prog.title)}</div>
                    ${prog.description ? `<div class="epg-program-desc">${this.escapeHtml(prog.description)}</div>` : ''}
                </div>
            `;
        }).join('');
    }

    showOverlay() {
        this.playerOverlay.style.display = 'flex';
        this.playerOverlay.classList.remove('hidden');
    }

    hideOverlay() {
        // Delay hiding to ensure smooth transition
        setTimeout(() => {
            if (this.videoPlayer.readyState >= 3 && !this.videoPlayer.paused) {
                this.playerOverlay.classList.add('hidden');
                setTimeout(() => {
                    if (this.playerOverlay.classList.contains('hidden')) {
                        this.playerOverlay.style.display = 'none';
                    }
                }, 300);
            }
        }, 500);
    }

    // Initialize and manage video control HUD (progress, play/pause, mute, fullscreen)
    initializeVideoControlsHUD() {
        // Create HUD element if it doesn't exist
        if (document.getElementById('videoControlsHUD')) return;

        const hud = document.createElement('div');
        hud.id = 'videoControlsHUD';
        hud.className = 'video-controls-hud';
        hud.innerHTML = `
            <div class="video-progress-container">
                <div class="video-progress-bar" id="videoProgressBar" style="--progress: 0%">
                    <div class="video-buffer-bar" id="videoBufferBar" style="--buffer: 0%"></div>
                </div>
                <div class="video-time" id="videoTime">0:00 / LIVE</div>
            </div>
            <div class="video-control-buttons">
                <div class="video-control-left">
                    <button class="video-control-btn" id="videoPlayBtn" title="Play/Pause">
                        <span id="playBtnIcon">▶</span>
                    </button>
                    <button class="video-control-btn" id="videoMuteBtn" title="Mute/Unmute">
                        <span id="muteBtnIcon">🔊</span>
                    </button>
                    <input type="range" id="videoVolumeSlider" class="video-volume-slider" min="0" max="100" value="100" style="display: flex;">
                    <button class="video-control-btn" id="videoCaptionsBtn" title="Toggle Captions">
                        <span id="captionsBtnIcon">CC</span>
                    </button>
                    <button class="video-control-btn" id="videoPiPBtn" title="Picture-in-Picture">
                        <span id="pipBtnIcon">⌖</span>
                    </button>
                    <button class="video-control-btn" id="videoMultiviewBtn" title="Toggle Multiview (4 channels)">
                        📺
                    </button>
                    <button class="video-control-btn" id="videoExitMultiviewBtn" title="Exit Multiview" style="display: none;">
                        ✕ Exit Multiview
                    </button>
                    <button class="video-control-btn" id="videoPartyBtn" title="Group Watching Party">
                        👥
                    </button>
                    <button class="video-control-btn" id="videoChannelSwitcherBtn" title="Switch Channel">
                        🎬
                    </button>
                    <button class="video-control-btn" id="videoRecordBtn" title="Record Stream">
                        <span id="recordBtnIcon">⏺</span>
                    </button>
                    <button class="video-control-btn" id="videoRecordingsBtn" title="View Recordings">
                        🎞️
                    </button>
                </div>
                <div class="video-control-right">
                    <button class="video-control-btn" id="videoFullscreenBtn" title="Fullscreen">
                        ⛶
                    </button>
                </div>
            </div>
        `;
        this.playerWrapper.appendChild(hud);

        // Event listeners
        const playBtn = document.getElementById('videoPlayBtn');
        const muteBtn = document.getElementById('videoMuteBtn');
        const captionsBtn = document.getElementById('videoCaptionsBtn');
        const pipBtn = document.getElementById('videoPiPBtn');
        const multiviewBtn = document.getElementById('videoMultiviewBtn');
        const exitMultiviewBtn = document.getElementById('videoExitMultiviewBtn');
        const partyBtn = document.getElementById('videoPartyBtn');
        const channelSwitcherBtn = document.getElementById('videoChannelSwitcherBtn');
        const fullscreenBtn = document.getElementById('videoFullscreenBtn');
        const progressBar = document.getElementById('videoProgressBar');

        if (playBtn) {
            playBtn.addEventListener('click', () => this.togglePlayPause());
        }
        if (muteBtn) {
            muteBtn.addEventListener('click', () => {
                this.videoPlayer.muted = !this.videoPlayer.muted;
                this.updateMuteButtonState();
                this.updateVolumeSliderVisibility();
            });
        }
        if (captionsBtn) {
            captionsBtn.addEventListener('click', () => this.toggleCaptions());
        }
        if (pipBtn) {
            pipBtn.addEventListener('click', () => this.togglePiP());
        }
        if (multiviewBtn) {
            multiviewBtn.addEventListener('click', () => this.toggleMultiview());
        }
        if (exitMultiviewBtn) {
            exitMultiviewBtn.addEventListener('click', () => this.exitMultiview());
        }
        if (partyBtn) {
            partyBtn.addEventListener('click', () => this.togglePartyModal());
        }
        if (channelSwitcherBtn) {
            channelSwitcherBtn.addEventListener('click', () => this.showChannelSwitcherModal());
        }
        const recordBtn = document.getElementById('videoRecordBtn');
        const recordingsBtn = document.getElementById('videoRecordingsBtn');
        if (recordBtn) {
            recordBtn.addEventListener('click', () => this.toggleRecording());
        }
        if (recordingsBtn) {
            recordingsBtn.addEventListener('click', () => this.showRecordingsModal());
        }
        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
            fullscreenBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleFullscreen();
            });
        }
        if (progressBar) {
            progressBar.addEventListener('click', (e) => {
                const rect = progressBar.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                if (this.videoPlayer.duration) {
                    this.videoPlayer.currentTime = percent * this.videoPlayer.duration;
                }
            });
        }
        // Volume slider
        const volumeSlider = document.getElementById('videoVolumeSlider');
        if (volumeSlider) {
            volumeSlider.addEventListener('input', (e) => {
                const volume = parseInt(e.target.value);
                this.videoPlayer.volume = volume / 100;
                // Update slider background gradient to show blue progress
                e.target.style.setProperty('--slider-value', `${volume}%`);
                // Update mute button icon
                const muteBtnIcon = document.getElementById('muteBtnIcon');
                if (muteBtnIcon) {
                    if (volume === 0) {
                        muteBtnIcon.textContent = '🔇';
                    } else if (volume < 50) {
                        muteBtnIcon.textContent = '🔉';
                    } else {
                        muteBtnIcon.textContent = '🔊';
                    }
                }
            });
            // Initialize slider background on page load
            const initialVolume = parseInt(volumeSlider.value);
            volumeSlider.style.setProperty('--slider-value', `${initialVolume}%`);
        }

        // Update HUD on video time update
        this.videoPlayer.addEventListener('timeupdate', () => this.updateVideoControlsHUD());
        this.videoPlayer.addEventListener('loadedmetadata', () => this.updateVideoControlsHUD());
        this.videoPlayer.addEventListener('play', () => this.updateVideoControlsHUD());
        this.videoPlayer.addEventListener('pause', () => this.updateVideoControlsHUD());
        this.videoPlayer.addEventListener('progress', () => this.updateVideoBufferBar());

        // Show/hide HUD on mouse move
        let hideTimeout;
        const showHUD = () => {
            const hud = document.getElementById('videoControlsHUD');
            if (hud) {
                hud.classList.add('show');
                clearTimeout(hideTimeout);
                if (!this.videoPlayer.paused) {
                    hideTimeout = setTimeout(() => hud.classList.remove('show'), 3000);
                }
            }
        };

        this.playerWrapper.addEventListener('mousemove', showHUD);
        this.playerWrapper.addEventListener('touchstart', showHUD);
        this.playerWrapper.addEventListener('mouseenter', showHUD);
    }

    updateVideoControlsHUD() {
        const progressBar = document.getElementById('videoProgressBar');
        const timeDisplay = document.getElementById('videoTime');
        const playBtn = document.getElementById('videoPlayBtn');
        const playBtnIcon = document.getElementById('playBtnIcon');

        // Update progress bar based on actual video duration or EPG program duration
        let displayDuration = this.videoPlayer.duration || 0;
        let displayCurrent = this.videoPlayer.currentTime || 0;

        // Try to get duration from EPG if available
        if (this.currentChannel && this.epgData && this.epgData.aligned) {
            const programs = this.epgData.aligned.get(this.currentChannel.id) || [];
            if (programs && programs.length > 0) {
                const now = Date.now();
                const currentProgram = programs.find(p => p.start <= now && p.stop >= now);
                if (currentProgram) {
                    displayDuration = (currentProgram.stop - currentProgram.start) / 1000; // ms to seconds
                    displayCurrent = (now - currentProgram.start) / 1000; // current position within program
                }
            }
        }

        // Update progress bar
        if (progressBar && displayDuration > 0) {
            const percent = (displayCurrent / displayDuration) * 100;
            progressBar.style.setProperty('--progress', `${Math.min(percent, 100)}%`);
            progressBar.style.background = `linear-gradient(90deg, rgba(33,150,243,0.4) ${Math.min(percent, 100)}%, rgba(255,255,255,0.1) ${Math.min(percent, 100)}%)`;
        }

        // Update time display
        if (timeDisplay) {
            const currentStr = this.formatSeconds(displayCurrent);
            let durationStr = 'LIVE';
            
            if (this.currentChannel && this.epgData && this.epgData.aligned) {
                const programs = this.epgData.aligned.get(this.currentChannel.id) || [];
                if (programs && programs.length > 0) {
                    const now = Date.now();
                    const currentProgram = programs.find(p => p.start <= now && p.stop >= now);
                    if (currentProgram) {
                        durationStr = this.formatSeconds((currentProgram.stop - currentProgram.start) / 1000);
                    }
                }
            }

            timeDisplay.textContent = `${currentStr} / ${durationStr}`;
        }

        // Update play button state
        if (playBtn && playBtnIcon) {
            playBtnIcon.textContent = this.videoPlayer.paused ? '▶' : '⏸';
        }

        this.updateMuteButtonState();
        this.updateCaptionButtonState();
        this.updateMultiviewButtonState();
    }

    updateVideoBufferBar() {
        const bufferBar = document.getElementById('videoBufferBar');
        if (!bufferBar || !this.videoPlayer.buffered) return;

        // Calculate buffered percentage
        let bufferedEnd = 0;
        if (this.videoPlayer.buffered.length > 0) {
            bufferedEnd = this.videoPlayer.buffered.end(this.videoPlayer.buffered.length - 1);
        }

        const duration = this.videoPlayer.duration || 0;
        if (duration > 0) {
            const bufferPercent = (bufferedEnd / duration) * 100;
            bufferBar.style.setProperty('--buffer', `${Math.min(bufferPercent, 100)}%`);
        }
    }

    updateMultiviewButtonState() {
        const multiviewBtn = document.getElementById('videoMultiviewBtn');
        const exitBtn = document.getElementById('videoExitMultiviewBtn');
        if (multiviewBtn) {
            multiviewBtn.classList.toggle('active', this.isMultiviewMode);
        }
        if (exitBtn) {
            exitBtn.style.display = this.isMultiviewMode ? 'inline-block' : 'none';
        }
    }

    updateMuteButtonState() {
        const muteBtnIcon = document.getElementById('muteBtnIcon');
        if (muteBtnIcon) {
            muteBtnIcon.textContent = this.videoPlayer.muted ? '🔇' : '🔊';
        }
    }

    updateVolumeSliderVisibility() {
        const volumeSlider = document.getElementById('videoVolumeSlider');
        if (volumeSlider) {
            // Hide slider if muted, show if not muted
            volumeSlider.style.display = this.videoPlayer.muted ? 'none' : 'flex';
        }
    }

    formatSeconds(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    onVideoLoadStart() {
        this.showOverlay();
        // Initialize HUD on first load
        if (!document.getElementById('videoControlsHUD')) {
            this.initializeVideoControlsHUD();
        }
    }

    onVideoError(event) {
        // Suppress format errors - they're usually non-fatal
        const error = this.videoPlayer.error;
        if (error) {
            // Only show critical errors that actually stop playback
            if (error.code === error.MEDIA_ERR_NETWORK) {
                console.warn('Network error (stream may recover)');
                // Don't show toast for network errors - stream usually recovers
            } else if (error.code === error.MEDIA_ERR_DECODE || error.code === error.MEDIA_ERR_SRC_NOT_SUPPORTED) {
                // Suppress format errors - mpegts.js handles them
                console.log('Format warning (ignored - mpegts.js handles it)');
                return; // Don't show error
            } else if (error.code === error.MEDIA_ERR_ABORTED) {
                // User action, don't show error
                return;
            }
        }
        // Only show if it's a real critical error
        console.warn('Video error (non-critical):', event);
    }

    toggleSidebar() {
        this.sidebar.classList.toggle('collapsed');
    }

    // EPG toggle removed - EPG is now always visible in sidebar

    clearAll() {
        // Stop all playback modes
        this.stopPlayback();
        this.stopAllMultiviewPlayers();
        
        // Exit multiview if active
        if (this.isMultiviewMode) {
            this.isMultiviewMode = false;
            this.multiViewGrid.style.display = 'none';
            this.playerWrapper.style.display = 'block';
            this.toggleMultiviewBtn.textContent = 'Multiview (4)';
            this.toggleMultiviewBtn.classList.remove('active');
        }

        this.channels = [];
        this.filteredChannels = [];
        this.currentChannel = null;
        this.epgData = null;
        this.m3uInput.value = '';
        this.epgInput.value = '';
        this.categoryFilter.innerHTML = '<option value="">All Categories</option>';
        this.searchInput.value = '';
        this.channelsList.innerHTML = '<p class="empty-state">Load an M3U playlist to get started</p>';
        this.currentChannelName.textContent = 'No channel selected';
        this.currentChannelInfo.textContent = 'Select a channel from the sidebar';
        if (this.nowPlayingTitle) this.nowPlayingTitle.textContent = 'No channel selected';
        if (this.nowPlayingSub) this.nowPlayingSub.textContent = 'Select a channel from the sidebar';
        if (this.epgContent) {
            this.epgContent.innerHTML = '<p class="empty-state">EPG will appear here when available</p>';
        }
        this.streamValidator.clearCache();
    }

    showLoading(show) {
        this.loading.style.display = show ? 'flex' : 'none';
        // Reset cancel flag when showing loading
        if (show) {
            this.isLoadingCancelled = false;
        }
    }

    sendDebugLog(message, level = 'INFO') {
        console.log(`[${level}] ${message}`);
        // Send to server for logging
        const encodedMsg = encodeURIComponent(message);
        fetch(`/debug?msg=${encodedMsg}&level=${level}`).catch(() => {});
    }

    showToast(message, type = 'info') {
        this.toast.textContent = message;
        this.toast.className = `toast show ${type}`;
        
        setTimeout(() => {
            this.toast.classList.remove('show');
        }, 5000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ============= Party/Group Watching Methods =============

    getUserColor(username) {
        // Return cached color or generate new one
        if (this.userColors[username]) {
            return this.userColors[username];
        }
        
        // Generate consistent color from username hash
        let hash = 0;
        for (let i = 0; i < username.length; i++) {
            hash = ((hash << 5) - hash) + username.charCodeAt(i);
            hash = hash & hash; // Convert to 32bit integer
        }
        
        // Color palette - vibrant colors
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
            '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B88B', '#A3E4D7',
            '#FC7F39', '#6BCB77', '#4D96FF', '#FF6B9D', '#C44569'
        ];
        
        const color = colors[Math.abs(hash) % colors.length];
        this.userColors[username] = color;
        return color;
    }

    togglePartyModal() {
        const modal = document.getElementById('partyModal');
        modal.setAttribute('aria-hidden', modal.getAttribute('aria-hidden') === 'false' ? 'true' : 'false');
        modal.style.display = modal.getAttribute('aria-hidden') === 'true' ? 'none' : 'block';
        
        if (modal.style.display === 'block' && !this.partyCode) {
            this.updatePartyUI();
        }
    }

    updatePartyUI() {
        if (this.partyCode) {
            // User is in a party
            document.getElementById('partyNotJoined').style.display = 'none';
            document.getElementById('partyJoined').style.display = 'block';
            document.getElementById('partyCodeDisplay').value = this.partyCode;
            this.updatePartyMembersList();
        } else {
            // User is not in a party
            document.getElementById('partyNotJoined').style.display = 'block';
            document.getElementById('partyJoined').style.display = 'none';
            document.getElementById('joinPartyForm').style.display = 'none';
        }
    }

    async createParty() {
        const username = document.getElementById('partyUsername').value.trim() || 'Friend';
        this.partyUsername = username;
        
        try {
            const response = await fetch(`/party/create?username=${encodeURIComponent(username)}`);
            const data = await response.json();
            
            if (data.success) {
                this.partyCode = data.party_code;
                this.isPartyHost = true;
                this.partyMembers = [{ username, id: 'host' }];
                this.updatePartyUI();
                this.showChatWidget();
                this.startPartySyncLoop();
                this.showToast(`Party created! Code: ${data.party_code}`, 'success');
            } else {
                this.showToast('Failed to create party', 'error');
            }
        } catch (e) {
            this.showToast('Error creating party', 'error');
            console.error(e);
        }
    }

    toggleJoinPartyForm() {
        const form = document.getElementById('joinPartyForm');
        form.style.display = form.style.display === 'none' ? 'block' : 'none';
    }

    async joinParty() {
        const code = document.getElementById('partyCodeInput').value.trim().toUpperCase();
        if (!code) {
            this.showToast('Please enter a party code', 'warning');
            return;
        }
        
        const username = document.getElementById('partyUsername').value.trim() || 'Friend';
        this.partyUsername = username;
        
        try {
            const response = await fetch(`/party/join?code=${code}&username=${encodeURIComponent(username)}`);
            const data = await response.json();
            
            if (data.success) {
                this.partyCode = code;
                this.isPartyHost = false;
                this.partyMembers = data.members || [];
                if (data.channel) {
                    // TODO: Auto-switch to host's channel when joining
                }
                this.updatePartyUI();
                this.showChatWidget();
                this.startPartySyncLoop();
                this.showToast(`Joined party ${code}!`, 'success');
            } else {
                this.showToast(data.error || 'Failed to join party', 'error');
            }
        } catch (e) {
            this.showToast('Error joining party', 'error');
            console.error(e);
        }
    }

    async leaveParty() {
        if (!this.partyCode) return;
        
        try {
            // Stop all sync loops FIRST
            this.stopPartySyncLoop();
            
            // Pause video to prevent audio loop
            if (this.videoPlayer) {
                this.videoPlayer.pause();
            }
            
            // Notify server
            await fetch(`/party/leave?code=${this.partyCode}`);
            
            // Clear party state
            this.hideChatWidget();
            this.partyCode = null;
            this.isPartyHost = false;
            this.partyMembers = [];
            this.lastChatTimestamp = 0;
            this.sentMessageIds.clear();
            
            // Update UI
            this.updatePartyUI();
            this.showToast('Left party', 'info');
        } catch (e) {
            console.error('Error leaving party:', e);
        }
    }

    copyPartyCode() {
        const code = document.getElementById('partyCodeDisplay').value;
        navigator.clipboard.writeText(code).then(() => {
            this.showToast('Party code copied!', 'success');
        }).catch(() => {
            this.showToast('Failed to copy code', 'error');
        });
    }

    async updatePartyMembersList() {
        if (!this.partyCode) return;
        
        try {
            const response = await fetch(`/party/state?code=${this.partyCode}`);
            const data = await response.json();
            
            if (data.success) {
                this.partyMembers = data.members || [];
                const list = document.getElementById('partyMembersList');
                const memberCount = document.getElementById('memberCount');
                memberCount.textContent = this.partyMembers.length;
                
                if (this.partyMembers.length === 0) {
                    list.innerHTML = '<div id="noMembers" style="color: #999; text-align: center;">No members</div>';
                } else {
                    list.innerHTML = this.partyMembers.map(member => {
                        const isHost = member.id === 'host' || data.host === member.username;
                        const color = this.getUserColor(member.username);
                        const hostLabel = isHost ? ' (Host)' : '';
                        return `<div class="party-member-item" style="border-left-color: ${color}; color: ${color};">${this.escapeHtml(member.username)}${hostLabel}</div>`;
                    }).join('');
                }
            }
        } catch (e) {
            console.error('Error updating party members:', e);
        }
    }

    startPartySyncLoop() {
        if (this.partySyncLoop) clearInterval(this.partySyncLoop);
        
        let lastSeenChannel = this.currentChannel?.id || null;
        let lastSeenTime = 0;
        
        // Sync every 100ms for tight synchronization
        this.partySyncLoop = setInterval(async () => {
            if (!this.partyCode) {
                clearInterval(this.partySyncLoop);
                return;
            }
            
            // Broadcast current playback state if host
            if (this.isPartyHost && this.currentChannel) {
                try {
                    await fetch('/party/update', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            code: this.partyCode,
                            channel: this.currentChannel.id,
                            playing: !this.videoPlayer.paused,
                            currentTime: this.videoPlayer.currentTime
                        })
                    });
                } catch (e) {
                    console.error('Error updating party state:', e);
                }
            } else if (!this.isPartyHost) {
                // Members: Check if host's channel or time changed and sync
                try {
                    const response = await fetch(`/party/state?code=${this.partyCode}`);
                    const data = await response.json();
                    
                    if (data.success) {
                        // Switch channel if host changed it
                        if (data.channel && data.channel !== lastSeenChannel) {
                            lastSeenChannel = data.channel;
                            const channel = this.channels.find(ch => ch.id === data.channel);
                            if (channel) {
                                console.log('[PARTY] Host switched to channel:', channel.name, 'ID:', data.channel);
                                this.playChannel(channel);
                                this.showToast(`Synced to host's channel: ${channel.name}`, 'info');
                            } else {
                                console.log('[PARTY] Channel not found in local list. Looking for ID:', data.channel);
                                console.log('[PARTY] Available channels:', this.channels.map(c => ({ id: c.id, name: c.name })));
                            }
                        }
                        
                        // Sync playback time if we're on the same channel
                        if (data.channel === lastSeenChannel && this.currentChannel && this.currentChannel.id === data.channel) {
                            const timeDiff = Math.abs(this.videoPlayer.currentTime - (data.currentTime || 0));
                            // Seek if more than 500ms out of sync (ultra-tight tolerance)
                            if (timeDiff > 0.5) {
                                this.videoPlayer.currentTime = data.currentTime || 0;
                                this.partyLastSeekTime = Date.now();
                            }
                            
                            // Sync play/pause state
                            if (data.playing && this.videoPlayer.paused) {
                                this.videoPlayer.play().catch(e => console.error('Play failed:', e));
                            } else if (!data.playing && !this.videoPlayer.paused) {
                                this.videoPlayer.pause();
                            }
                        }
                    }
                } catch (e) {
                    console.error('Error syncing channel:', e);
                }
            }
            
            // Update member list every 500ms instead of 200ms
            if (Date.now() % 1000 < 200) {
                await this.updatePartyMembersList();
            }
        }, 100);
        
        // Start chat polling
        this.startChatPollLoop();
    }

    stopPartySyncLoop() {
        if (this.partySyncLoop) {
            clearInterval(this.partySyncLoop);
            this.partySyncLoop = null;
        }
        if (this.partyChatPollLoop) {
            clearInterval(this.partyChatPollLoop);
            this.partyChatPollLoop = null;
        }
        // Reset sync tracking
        this.isSendingMessage = false;
    }

    // ============= Chat Methods =============

    showChatWidget() {
        const widget = document.getElementById('chatWidget');
        widget.style.display = 'flex';
        widget.classList.remove('chat-widget-minimized');
    }

    hideChatWidget() {
        const widget = document.getElementById('chatWidget');
        widget.style.display = 'none';
    }

    toggleMinimizeChatWidget() {
        const widget = document.getElementById('chatWidget');
        widget.classList.toggle('chat-widget-minimized');
    }

    initializeChatDragable() {
        const chatWidget = document.getElementById('chatWidget');
        const dragHandle = document.getElementById('chatDragHandle');
        
        if (!chatWidget || !dragHandle) return;
        
        let isDragging = false;
        let offsetX = 0;
        let offsetY = 0;
        
        dragHandle.addEventListener('mousedown', (e) => {
            isDragging = true;
            const rect = chatWidget.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            dragHandle.style.cursor = 'grabbing';
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            let newX = e.clientX - offsetX;
            let newY = e.clientY - offsetY;
            
            // Keep widget within viewport bounds
            const maxX = window.innerWidth - chatWidget.offsetWidth;
            const maxY = window.innerHeight - chatWidget.offsetHeight;
            
            newX = Math.max(0, Math.min(newX, maxX));
            newY = Math.max(0, Math.min(newY, maxY));
            
            chatWidget.style.position = 'fixed';
            chatWidget.style.left = newX + 'px';
            chatWidget.style.top = newY + 'px';
            chatWidget.style.bottom = 'auto';
            chatWidget.style.right = 'auto';
        });
        
        document.addEventListener('mouseup', () => {
            isDragging = false;
            dragHandle.style.cursor = 'grab';
        });
        
        // Touch support for mobile
        dragHandle.addEventListener('touchstart', (e) => {
            isDragging = true;
            const rect = chatWidget.getBoundingClientRect();
            const touch = e.touches[0];
            offsetX = touch.clientX - rect.left;
            offsetY = touch.clientY - rect.top;
        });
        
        document.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            
            const touch = e.touches[0];
            let newX = touch.clientX - offsetX;
            let newY = touch.clientY - offsetY;
            
            const maxX = window.innerWidth - chatWidget.offsetWidth;
            const maxY = window.innerHeight - chatWidget.offsetHeight;
            
            newX = Math.max(0, Math.min(newX, maxX));
            newY = Math.max(0, Math.min(newY, maxY));
            
            chatWidget.style.position = 'fixed';
            chatWidget.style.left = newX + 'px';
            chatWidget.style.top = newY + 'px';
            chatWidget.style.bottom = 'auto';
            chatWidget.style.right = 'auto';
        });
        
        document.addEventListener('touchend', () => {
            isDragging = false;
        });
    }

    async sendChatMessage() {
        if (!this.partyCode || this.isSendingMessage) return;
        
        const input = document.getElementById('chatMessageInput');
        const text = input.value.trim();
        
        if (!text) return;
        
        this.isSendingMessage = true;
        
        try {
            // Create unique ID for this message to avoid duplicates
            const msgId = `${this.partyUsername}-${Date.now()}-${Math.random()}`;
            this.sentMessageIds.add(msgId);
            
            // Add message to UI immediately so sender sees it
            this.addChatMessageToUI({
                username: this.partyUsername,
                text: text,
                timestamp: Date.now() / 1000,
                _msgId: msgId
            });
            
            const response = await fetch('/party/send-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    code: this.partyCode,
                    username: this.partyUsername,
                    text: text
                })
            });
            
            const data = await response.json();
            if (data.success) {
                input.value = '';
                this.lastChatTimestamp = Date.now() / 1000;
            } else {
                this.showToast('Failed to send message', 'error');
            }
        } catch (e) {
            console.error('Error sending message:', e);
        } finally {
            this.isSendingMessage = false;
        }
    }

    startChatPollLoop() {
        if (this.partyChatPollLoop) clearInterval(this.partyChatPollLoop);
        
        // Poll for messages every 500ms
        this.partyChatPollLoop = setInterval(async () => {
            if (!this.partyCode) {
                clearInterval(this.partyChatPollLoop);
                return;
            }
            
            await this.pollChatMessages();
        }, 500);
    }

    async pollChatMessages() {
        if (!this.partyCode) return;
        
        try {
            const response = await fetch(`/party/messages?code=${this.partyCode}&since=${this.lastChatTimestamp}`);
            const data = await response.json();
            
            if (data.success && data.messages && data.messages.length > 0) {
                const messagesContainer = document.getElementById('chatMessages');
                
                // Clear empty state if needed
                if (document.getElementById('chatEmpty')) {
                    document.getElementById('chatEmpty').remove();
                }
                
                for (const msg of data.messages) {
                    // Create unique key for deduplication
                    const msgKey = `${msg.username}|${msg.text}|${Math.floor(msg.timestamp)}`;
                    
                    // Skip if we just sent this message or it's already in the DOM
                    if (!this.sentMessageIds.has(msgKey)) {
                        // Also check if message is already displayed
                        const existingMessages = Array.from(messagesContainer.querySelectorAll('.chat-message-text'))
                            .map(el => el.textContent);
                        
                        if (!existingMessages.includes(msg.text)) {
                            this.addChatMessageToUI(msg);
                        }
                    }
                    this.lastChatTimestamp = Math.max(this.lastChatTimestamp, msg.timestamp || 0);
                }
                
                // Auto-scroll to bottom
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        } catch (e) {
            console.error('Error polling messages:', e);
        }
    }

    addChatMessageToUI(message) {
        const container = document.getElementById('chatMessages');
        if (!container) return;
        
        const color = this.getUserColor(message.username);
        const msgEl = document.createElement('div');
        msgEl.className = 'chat-message';
        msgEl.innerHTML = `
            <div class="chat-message-username" style="color: ${color}; font-weight: 600;">${this.escapeHtml(message.username)}</div>
            <div class="chat-message-text" style="border-left-color: ${color};">${this.escapeHtml(message.text)}</div>
        `;
        container.appendChild(msgEl);
    }

    // ============ VOLUME CONTROL ============
    updateVolume() {
        if (this.videoPlayer) {
            this.videoPlayer.volume = this.volume / 100;
        }
        if (this.volumeSlider) {
            this.volumeSlider.value = this.volume;
        }
        if (this.volumeValue) {
            this.volumeValue.textContent = `${this.volume}%`;
        }
        
        // Update button icon
        if (this.volumeBtn) {
            if (this.volume === 0) {
                this.volumeBtn.textContent = '🔇';
            } else if (this.volume < 50) {
                this.volumeBtn.textContent = '🔉';
            } else {
                this.volumeBtn.textContent = '🔊';
            }
        }
        
        // Update multiview volumes
        this.multiviewVideos.forEach(video => {
            if (video) video.volume = this.volume / 100;
        });
    }

    toggleMute() {
        if (this.volume === 0) {
            this.volume = 100;
        } else {
            this.volume = 0;
        }
        this.updateVolume();
    }

    // ============ PLAYBACK CONTROLS ============
    togglePlayPause() {
        if (this.videoPlayer) {
            if (this.videoPlayer.paused) {
                this.videoPlayer.play();
            } else {
                this.videoPlayer.pause();
            }
        }
    }

    // ============ ASPECT RATIO ============
    setAspectRatio(aspect) {
        this.currentAspectRatio = aspect;
        if (this.videoPlayer) {
            switch (aspect) {
                case '16:9':
                    this.videoPlayer.style.objectFit = 'contain';
                    this.videoPlayer.style.aspectRatio = '16 / 9';
                    break;
                case '4:3':
                    this.videoPlayer.style.objectFit = 'contain';
                    this.videoPlayer.style.aspectRatio = '4 / 3';
                    break;
                case 'stretch':
                    this.videoPlayer.style.objectFit = 'fill';
                    this.videoPlayer.style.aspectRatio = 'unset';
                    break;
                case 'fit':
                    this.videoPlayer.style.objectFit = 'contain';
                    this.videoPlayer.style.aspectRatio = 'unset';
                    break;
            }
        }
        
        // Save preference
        localStorage.setItem('m3u.aspectRatio', aspect);
    }

    // ============ BUFFER INDICATOR ============
    updateBufferStatus(status) {
        this.bufferStatus = status;
        if (!this.bufferFill || !this.bufferText) return;
        
        switch (status) {
            case 'buffering':
                this.bufferFill.style.width = '100%';
                this.bufferFill.style.background = 'linear-gradient(90deg, #FF9800, #F57C00)';
                this.bufferText.textContent = 'Buffering...';
                break;
            case 'ready':
                this.bufferFill.style.width = '100%';
                this.bufferFill.style.background = 'linear-gradient(90deg, #4CAF50, #45a049)';
                this.bufferText.textContent = 'Ready';
                break;
            case 'error':
                this.bufferFill.style.width = '100%';
                this.bufferFill.style.background = 'linear-gradient(90deg, #F44336, #E53935)';
                this.bufferText.textContent = 'Error';
                break;
            default:
                this.bufferFill.style.width = '0%';
                this.bufferText.textContent = 'Idle';
        }
    }

    // ============ AUTO-RESUME ============
    saveLastWatchedChannel() {
        if (this.currentChannel) {
            this.lastWatchedChannelId = this.currentChannel.id;
            localStorage.setItem('m3u.lastWatchedChannelId', this.currentChannel.id);
        }
    }

    resumeLastChannel() {
        const lastChannelId = localStorage.getItem('m3u.lastWatchedChannelId');
        if (lastChannelId && this.channels.length > 0) {
            const channel = this.channels.find(c => c.id === lastChannelId);
            if (channel) {
                setTimeout(() => {
                    this.playChannel(channel, null);
                }, 500);
            }
        }
    }

    // ============ FULLSCREEN CHANNEL SWITCHER ============
    showChannelSwitcherModal() {
        if (!this.channelSwitcherModal) return;
        
        this.channelSwitcherModal.style.display = 'flex';
        this.populateChannelSwitcherModal();
    }

    hideChannelSwitcherModal() {
        if (this.channelSwitcherModal) {
            this.channelSwitcherModal.style.display = 'none';
        }
    }

    populateChannelSwitcherModal() {
        if (!this.channelSwitcherList) return;
        
        this.channelSwitcherList.innerHTML = '';
        
        const visibleChannels = this.filteredChannels.length > 0 ? this.filteredChannels : this.channels;
        
        visibleChannels.forEach(channel => {
            const item = document.createElement('div');
            item.className = 'channel-switcher-item';
            if (this.currentChannel && this.currentChannel.id === channel.id) {
                item.classList.add('active');
            }
            
            const overrides = this.channelOverrides[channel.id] || {};
            const displayName = overrides.name || channel.name;
            const displayGroup = overrides.group || channel.group || 'Uncategorized';
            const logoUrl = overrides.logo || channel.tvgLogo || channel.logo || '';
            
            // Get current EPG program for this channel
            let epgInfo = '';
            if (this.epgData && this.epgData.aligned) {
                const programs = this.epgData.aligned.get(channel.id) || [];
                if (programs.length > 0) {
                    const now = Date.now();
                    const currentProgram = programs.find(p => {
                        const startTime = new Date(p.start).getTime();
                        const endTime = new Date(p.stop).getTime();
                        return startTime <= now && now < endTime;
                    });
                    if (currentProgram) {
                        epgInfo = currentProgram.title || '';
                    }
                }
            }
            
            item.innerHTML = `
                <div class="channel-item-content">
                    ${logoUrl ? `<img class="channel-item-logo" src="${logoUrl}" alt="${displayName}" onerror="this.style.display='none';this.parentElement.querySelector('.channel-item-logo-placeholder')?.style.display='flex';">` : ''}
                    <div class="channel-item-logo-placeholder" style="${logoUrl ? 'display:none;' : 'display:flex;'}">📺</div>
                    <div class="channel-item-info">
                        <div class="channel-item-name">${displayName}</div>
                        <div class="channel-item-group">${displayGroup}</div>
                        ${epgInfo ? `<div class="channel-item-epg">${epgInfo}</div>` : ''}
                    </div>
                </div>
            `;
            
            item.addEventListener('click', () => {
                this.playChannel(channel);
                this.hideChannelSwitcherModal();
            });
            
            this.channelSwitcherList.appendChild(item);
        });
    }
}


// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new M3UPlayerApp();
});

