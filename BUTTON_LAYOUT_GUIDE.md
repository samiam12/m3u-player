# HUD Button Layout - Visual Guide

## Control Button Arrangement (In Order)

```
┌─────────────────────────────────────────────────────────────────┐
│                    VIDEO CONTROL HUD                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Progress Bar  [████████░░░░░░░░░░░░░░░░░░░░░░]  0:35 / 1:00   │
│                                                                 │
│  LEFT BUTTONS                                  RIGHT BUTTONS    │
│  ┌──────────────────────────────────┐         ┌──────────────┐  │
│  │ ▶  🔊  CC  ⌖  📺  ✕ Exit Multi... │         │      ⛶       │  │
│  │                                    │         │              │  │
│  │ Play Mute Captions PiP Multiview Exit  →   Fullscreen      │  │
│  └──────────────────────────────────┘         └──────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Individual Button Details

### LEFT PANEL BUTTONS (appear in this order)

#### 1. Play/Pause Button
- **Icon**: ▶ (play) or ⏸ (pause)
- **Title**: "Play/Pause"
- **State**: Changes based on video playback state
- **Function**: `togglePlayPause()`

#### 2. Mute Button ✨ EXISTING
- **Icon**: 🔊 (unmuted) or 🔇 (muted)
- **Title**: "Mute/Unmute"
- **State**: Reflects audio state
- **Function**: Toggles `videoPlayer.muted`

#### 3. Captions Button ⭐ NEW
- **Icon**: `CC`
- **Title**: "Toggle Captions"
- **State**: Blue highlight when enabled
- **Function**: `toggleCaptions()`
- **Visual**: White text on transparent background, turns blue when active

#### 4. Picture-in-Picture Button ⭐ NEW
- **Icon**: `⌖` (target/focus symbol)
- **Title**: "Picture-in-Picture"
- **State**: Always available
- **Function**: `togglePiP()`
- **Works**: Desktop browsers + iPad Safari

#### 5. Multiview Button ✨ EXISTING
- **Icon**: 📺 (television)
- **Title**: "Toggle Multiview (4 channels)"
- **State**: Blue highlight when multiview active
- **Function**: `toggleMultiview()`
- **Behavior**: Shows exit button when activated

#### 6. Exit Multiview Button ⭐ NEW
- **Icon**: Text label: `✕ Exit Multiview`
- **Title**: "Exit Multiview"
- **State**: Hidden by default, shown only when in multiview mode
- **Function**: `exitMultiview()`
- **Visibility**: Dynamically shows/hides based on mode
- **Styling**: Same as other buttons

### RIGHT PANEL BUTTON

#### Fullscreen Button
- **Icon**: ⛶ (fullscreen symbol)
- **Title**: "Fullscreen"
- **State**: Always available
- **Function**: `toggleFullscreen()`

---

## Button States & Colors

### Default State
```
Background: rgba(255,255,255,0.15)  (semi-transparent white)
Border: 1px solid rgba(255,255,255,0.2)
Color: white text
```

### Hover State
```
Background: rgba(255,255,255,0.25)  (slightly more opaque)
Transform: scale(1.05)  (grows 5%)
Transition: 0.2s ease
```

### Active State (Pressed)
```
Transform: scale(0.95)  (shrinks 5%)
```

### Enabled/On State (for toggle buttons)
```
Background: var(--primary-color)  (#2196F3 blue)
Border-color: #2196F3
Color: white
```

---

## Responsive Behavior

### Desktop (Full HUD visible)
```
All buttons visible and clickable
Full spacing between buttons
Hover effects enabled
Mouse-based interaction
```

### Mobile/Tablet (Touch Interface)
```
All buttons visible and tappable
Larger touch targets (easier to tap)
HUD auto-hides after 3 seconds (no gesture)
Touch shows HUD for 3 seconds
```

### Multiview Mode
```
Exit Multiview button visible
Standard Multiview button replaced with exit option
Other buttons remain functional
PiP button works on selected slot video
```

---

## Animation & Transitions

### HUD Fade In/Out
```
Duration: 300ms
Opacity: 0 → 1 (fade in)
Opacity: 1 → 0 (fade out)
Trigger: Mouse move, touch start
Auto-hide: 3 seconds (if playing)
```

### Button Hover Effect
```
Duration: 0.2s
Scale: 1.0 → 1.05
Easing: ease
Smooth transition on mouse over
```

### Button Press Effect
```
Duration: Instant
Scale: 1.0 → 0.95
Provides tactile feedback
Returns to normal on release
```

---

## Accessibility

### Keyboard Support
- All buttons have semantic `<button>` elements
- `title` attributes for tooltips
- Semantic HTML structure
- ARIA labels where needed

### Touch Support
- Touch-friendly button sizes (40px+ minimum)
- No hover-only interactions
- Tap feedback immediately visible
- Keyboard navigation fully supported

### Screen Readers
- Button labels in title attributes
- Semantic button elements
- Clear icon/text combinations

---

## Spacing & Layout

```
Button Padding: 8px 14px (compact but comfortable)
Gap between buttons: 6px (tight grouping)
Button Height: ~34px
Display: Flex with space-between for left/right separation
Backdrop: Blur effect for modern look
Border-radius: 8px for rounded corners
```

---

## Example State Combinations

### Single View, Playing
```
[▶] [🔊] [CC] [⌖] [📺]                    [⛶]
 ▲                 
 └─ Play icon (since video is paused initially)
```

### Single View, Playing with Captions
```
[⏸] [🔊] [CC] [⌖] [📺]                    [⛶]
           ▲ (blue highlight - captions on)
```

### Multiview Mode, Active
```
[▶] [🔊] [CC] [⌖] [📺] [✕ Exit Multiview]  [⛶]
                  ▲         ▲
            (blue highlight) (visible only in multiview)
```

### Multiview Mode, Exit Button Visible
```
[▶] [🔊] [CC] [⌖] [📺] [✕ Exit Multiview]  [⛶]
                           └─ Click to return to single view
```

---

## Keyboard Shortcuts (Optional Enhancement)

Current shortcuts in app:
- `Space` - Play/Pause
- `M` - Mute/Unmute
- `F` - Fullscreen
- `V` - Multiview (could be enhanced)

Could add in future:
- `C` - Toggle Captions
- `P` - Picture-in-Picture
- `X` - Exit Multiview

---

## Testing the Buttons

### Quick Test Sequence
1. Load a playlist
2. Click a channel to start playback
3. Test each button left-to-right:
   - Click play/pause ✓
   - Click mute ✓
   - Click captions ✓
   - Click PiP ✓
   - Click multiview ✓
4. In multiview mode:
   - Verify exit button appears ✓
   - Click exit button ✓
   - Verify single view restored ✓
5. Test on multiple devices:
   - Desktop Chrome/Firefox/Safari ✓
   - iPad Safari ✓
   - Android Chrome ✓

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Exit button not appearing | Verify `isMultiviewMode` is true |
| Captions not toggling | Check if video has text tracks |
| PiP not working | Check browser supports API, user gesture required |
| Buttons styling off | Clear CSS cache (Ctrl+Shift+R) |
| HUD not fading | Verify video is playing, not paused |
