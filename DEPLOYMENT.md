# 🚀 Deployment Guide - 3D Constellation Tracker

## ✅ Pre-Deployment Checklist

- [x] TLE dynamic update system implemented
- [x] Cache system with 2-day TTL
- [x] Fallback to static files
- [x] All constellations configured
- [x] Production build optimized
- [x] Vercel configuration ready
- [x] API proxy with security allowlist
- [x] Development files cleaned

---

## 🌐 Deploy to Vercel (Recommended)

### Option 1: Vercel CLI

```bash
# Install Vercel CLI (first time only)
npm install -g vercel

# Login to Vercel
vercel login

# Deploy to production
vercel --prod
```

### Option 2: GitHub Integration (Automatic)

1. **Push to GitHub:**
   ```bash
   git add .
   git commit -m "feat: production-ready with dynamic TLE system"
   git push origin main
   ```

2. **Connect to Vercel:**
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import your GitHub repository
   - Configure project:
     - **Framework Preset:** Other
     - **Build Command:** `npm run vercel-build`
     - **Output Directory:** `dist/starlink-handover-visualizer`
   - Click "Deploy"

3. **Automatic Deployments:**
   - Every push to `main` → Production deployment
   - Pull requests → Preview deployments
   - Vercel handles Edge Functions automatically

---

## 🔧 Configuration

### Environment Variables (Optional)

No environment variables required! Everything works out of the box.

### Custom Domain

In Vercel Dashboard:
1. Go to Project Settings → Domains
2. Add your custom domain
3. Follow DNS configuration instructions

---

## 🛰️ How It Works in Production

### TLE Update System

```
User visits app
  → Tries IndexedDB cache (2-day TTL)
  → If expired: Calls /api/tle serverless function
  → Function fetches from CelesTrak
  → Saves to IndexedDB
  → Shows satellites

Next visits (< 2 days):
  → Uses cached data (instant load)

After 2 days:
  → Auto-refreshes from CelesTrak
```

### Supported Constellations

All configured in `/api/tle.ts`:
- ✅ Starlink
- ✅ OneWeb
- ✅ GPS
- ✅ Galileo
- ✅ GLONASS
- ✅ BeiDou
- ✅ Iridium
- ✅ Globalstar
- ✅ ORBCOMM
- ✅ Telesat
- ✅ SatNOGS
- ✅ Amateur Radio
- ✅ SES
- ✅ Intelsat
- ✅ Eutelsat
- ✅ Experimental
- ✅ Kuiper

---

## 📊 Performance

### Build Output
- **Gzipped:** ~1.2 MB (vendor) + ~100 KB (app)
- **Load Time:** < 2s (first visit)
- **TTI:** < 3s

### CDN & Caching
- Static assets: Cached at edge
- TLE API: 2-day cache with stale-while-revalidate
- IndexedDB: Client-side 2-day cache

---

## 🐛 Troubleshooting

### Build Fails
```bash
# Clear cache and rebuild
rm -rf node_modules dist .angular
npm install
npm run build
```

### API Not Working
Check Vercel Function logs:
1. Go to Vercel Dashboard
2. Deployment → Functions
3. View `/api/tle` logs

### TLE Data Issues
Fallback files in `/src/assets/gp_*.txt` always work as backup.

---

## 🎯 Post-Deployment Verification

### 1. Check Homepage
- ✅ Loads without errors
- ✅ Earth model visible
- ✅ Satellites render

### 2. Test TLE API
```bash
curl https://your-domain.vercel.app/api/tle?group=starlink
# Should return TLE data
```

### 3. Check Console
Open DevTools:
```
✅ Loaded XXXX satellites for starlink (source: remote)
```

### 4. Test Cache
Reload page → should show:
```
✅ Loaded XXXX satellites for starlink (source: cache)
```

---

## 🔄 Updates & Maintenance

### Update TLE Data
No manual action needed! Updates automatically every 2 days.

### Force Update (if needed)
In browser console:
```javascript
await tle.forceRefresh()
```

### Add New Constellation
1. Edit `api/tle.ts` → Add to `ALLOWED_GROUPS`
2. Add fallback file: `src/assets/gp_<name>.txt`
3. Push to GitHub → Auto-deploy

---

## 📝 Files Structure (Production)

```
/
├── api/
│   ├── tle.ts          # Serverless function (production)
│   └── tle.js          # Not used in production
├── src/
│   ├── app/            # Angular application
│   ├── assets/
│   │   └── gp_*.txt    # Static TLE fallback files
│   └── ...
├── vercel.json         # Vercel configuration
├── package.json        # Dependencies & scripts
└── README.md           # Documentation
```

---

## ✨ Features in Production

✅ **Real-time TLE Updates:** Auto-refresh every 2 days
✅ **Multiple Constellations:** 18+ constellations supported
✅ **Offline Support:** Works with cached/static data
✅ **Performance:** CDN + Edge Functions + IndexedDB
✅ **Zero Config:** Works out of the box
✅ **Auto-scaling:** Vercel handles traffic spikes
✅ **HTTPS:** Secure by default
✅ **Global CDN:** Fast worldwide

---

## 🎉 You're Ready!

The project is **production-ready** and optimized for Vercel deployment.

```bash
# Final step:
vercel --prod
```

Enjoy your 3D Constellation Tracker! 🛰️✨
