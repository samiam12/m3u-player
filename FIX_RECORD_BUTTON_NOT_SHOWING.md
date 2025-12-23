# Fix: Record Button Not Showing on Render

## Issue
Record button (⏺) and Recordings button (🎞️) don't appear in Render deployment but work on localhost.

## Solution

### Option 1: Hard Refresh Browser (Do This First)
1. Go to your Render URL: `https://m3u-player.onrender.com`
2. **Hard refresh** (clear cache):
   - Windows/Linux: `Ctrl + Shift + R`
   - Mac: `Cmd + Shift + R`
3. Or: Open DevTools (`F12`) → Settings → check "Disable cache (while DevTools open)"

### Option 2: Manual Render Redeploy (If refresh doesn't work)
1. Go to https://dashboard.render.com
2. Find your **m3u-player** service
3. Click **"Manual Deploy"** → **"Latest Commit"**
4. Wait 2-3 minutes for build to complete
5. Check the **Logs** tab - should show:
   ```
   M3U Player Server
   ============================================================
   ```
6. Once green, refresh your browser

### Option 3: Check if Deploy Actually Happened
1. Open browser DevTools: `F12`
2. Go to **Console** tab
3. Type: `app.isRecording` (should return `false` or `true`)
4. If error "app is not defined", the new JavaScript hasn't loaded

If it says "not defined", the old version is still cached/deployed.

---

## Why This Happened

**Possible causes:**
1. **Browser cache** - Old index.html/app.js cached locally
2. **Render cache** - Render may use build cache, needs fresh deploy
3. **CDN cache** - If using CDN, may take time to clear

---

## Verification

After fix, you should see in HUD (left to right):

```
[▶] [🔊] [Volume] [CC] [⌖] [📺] [✕*] [🎬] [⏺] [🎞️]     [⛶]
                                         ↑      ↑
                                      NEW!    NEW!
```

- **⏺ Record** button
- **🎞️ Recordings** button  

Both should appear in the video control HUD.

---

## Troubleshooting

### Still no buttons after hard refresh + redeploy?

Check server is actually running the new code:

```bash
# Check if render.yaml exists in repo
git show HEAD:render.yaml

# Check app.js has the record button
git show HEAD:app.js | grep -A2 "videoRecordBtn"
```

Both should show the new code.

### If Render shows "Deploy Failed"

1. Check the **Logs** tab for errors
2. Common error: ffmpeg install failing
   - This is non-critical, server still starts
   - Recording will fail until ffmpeg installed manually

3. To manually install ffmpeg on Render (if deploy fails):
   - This requires SSH access or Render support
   - Or redeploy and ignore ffmpeg errors for now

---

## Quick Checklist

- [ ] Hard refresh browser (Ctrl+Shift+R)
- [ ] Check browser console for "app is defined"
- [ ] Manual redeploy from Render dashboard
- [ ] Check Render Logs show server started
- [ ] Wait 2-3 minutes for deploy to complete
- [ ] Refresh page and look for ⏺ and 🎞️ buttons

---

**Most likely: Just do a hard refresh (Ctrl+Shift+R) and it will appear!**

If that doesn't work, trigger a manual redeploy from Render dashboard.
