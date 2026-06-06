# KudiTrack AI 💚

**Smart Finance Tracker for Nigerian Small Business Owners & Market Traders**

Built with React + Tailwind CSS + Claude AI (Anthropic).

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up your environment variables
cp .env.example .env
# Edit .env and add your REACT_APP_ANTHROPIC_API_KEY

# 3. Start the development server
npm start
# Opens at http://localhost:3000
```

---

## 📁 Project Structure

```
kuditrack/
├── public/
│   └── index.html
└── src/
    ├── App.jsx                  # Root component + routing
    ├── index.js                 # React entry point
    ├── index.css                # Global styles (Tailwind)
    ├── components/
    │   ├── Icon.jsx             # Inline SVG icon set
    │   ├── SyncBar.jsx          # Offline / sync status banner
    │   ├── BottomNav.jsx        # Bottom navigation bar
    │   └── shared/
    │       ├── Modal.jsx        # Bottom-sheet modal
    │       ├── Field.jsx        # Form input / select / textarea
    │       └── Badge.jsx        # Status badge
    ├── screens/
    │   ├── Home.jsx             # Dashboard
    │   ├── Transactions.jsx     # Record & view sales/expenses
    │   ├── Credit.jsx           # Credit tracker
    │   ├── Aso.jsx              # Aso/Esusu savings manager
    │   ├── Insights.jsx         # AI-powered financial insights
    │   └── Settings.jsx         # Profile, dark mode, etc.
    ├── hooks/
    │   ├── useStore.js          # Central state management
    │   └── useAI.js             # Anthropic API hook
    └── utils/
        ├── helpers.js           # fmt(), today(), uid(), filterByPeriod()
        ├── offlineDb.js         # IndexedDB offline storage
        ├── syncManager.js       # Online/offline sync logic
        └── pdfExport.js         # jsPDF receipt & statement exports
```

---

## ✨ Features

| Module         | What it does |
|----------------|-------------|
| 🏠 Home        | Daily cash in/out summary, credit & Aso overview, recent transactions |
| 💰 Transactions | Record sales, expenses, stock purchases; filter by type; download PDF receipt |
| 📋 Credit      | Track customer debts, record repayments, progress bar, export PDF statement |
| 🕐 Aso Savings | Manage daily/weekly/monthly savings clients; contributions & withdrawals with fee |
| ✨ AI Insights  | Claude AI analyzes your data and gives insights, warnings, opportunities & actions |
| ⚙️ Settings    | Edit business profile, toggle dark mode, premium & support links |

---

## 🔑 Environment Variables

| Variable                        | Required | Description |
|---------------------------------|----------|-------------|
| `REACT_APP_ANTHROPIC_API_KEY`   | ✅ Yes   | Anthropic API key for AI Insights |
| `REACT_APP_PAYSTACK_PUBLIC_KEY` | Optional | Paystack key for Premium payments |

---

## 📦 Adding PDF Export

PDF export uses **jsPDF**. Install it:

```bash
npm install jspdf
```

Then the download buttons on Transactions, Credit, and Aso screens will work.

---

## 🌐 Offline Support

- `src/utils/offlineDb.js` — saves transactions to IndexedDB when offline
- `src/utils/syncManager.js` — syncs pending records when connection is restored
- `SyncBar` component shows a banner when offline or syncing

Wire up `syncManager.syncPendingTransactions()` to your real backend API endpoint in `syncManager.js`.

---

## 🛠 Next Steps / Extending

- **Voice recording** — Web Speech API in `Transactions.jsx` (mic button ready)
- **Paystack integration** — add to `Settings → Premium`
- **Push notifications** — service worker + Web Push API
- **Dark mode** — profile.dark_mode is tracked; apply `dark:` Tailwind classes
- **Backend API** — replace in-memory `useStore` with real API calls

---

## 📄 License

MIT — built for Nigerian market traders 🇳🇬
