// server.js
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Config (your keys pre-filled!)
const ADZUNA_APP_ID = '497152ce';
const ADZUNA_APP_KEY = '330b734995490b9b7cf84c21d619fde1';
const IPGEO_API_KEY = 'dd8fbbec37d34928afc0572c5b955c52';

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// Simple in-memory cache (stretches Adzuna limits)
const cache = new Map();

// Check if IP is VPN/proxy
async function isSuspiciousIP(ip) {
  try {
    const res = await fetch(`https://api.ipgeolocation.io/ipgeo?apiKey=${IPGEO_API_KEY}&ip=${ip}&fields=security`);
    const data = await res.json();
    return data.security?.is_proxy || data.security?.is_datacenter || data.security?.is_vpn;
  } catch (e) {
    console.log("IP check failed:", e);
    return false; // Allow if API fails
  }
}

// Adzuna job search
app.get('/api/jobs', async (req, res) => {
  const { keyword = 'developer', country = 'ca', isPremium = 'false' } = req.query;
  const cacheKey = `${keyword}-${country}-${isPremium}`;
  
  // Return cached result if fresh (<1 hour)
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    if (Date.now() - cached.timestamp < 3600000) {
      return res.json(cached.data);
    }
  }

  try {
    // Adzuna API call
    const adzunaUrl = `https://api.adzuna.com/v1/api/jobs/${country}/search/1?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}&results_per_page=50&what=${encodeURIComponent(keyword)}&content-type=application/json`;
    const adzunaRes = await fetch(adzunaUrl);
    const adzunaData = await adzunaRes.json();

    // Visa keywords filter
    const visaKeywords = ['visa sponsorship', 'lmia', 'work permit', 'sponsorship available', 'eligible to work'];
    let jobs = (adzunaData.results || []).filter(job => {
      const text = (job.title + ' ' + (job.description?.text || '')).toLowerCase();
      return visaKeywords.some(kw => text.includes(kw));
    });

    // Premium: add no-experience keywords
    if (isPremium === 'true') {
      const noExpKeywords = ['no experience', 'entry level', 'trainee', 'apprentice', 'beginner'];
      jobs = jobs.filter(job => {
        const text = (job.title + ' ' + (job.description?.text || '')).toLowerCase();
        return noExpKeywords.some(kw => text.includes(kw)) || 
               visaKeywords.some(kw => text.includes(kw));
      });
    }

    // Free: limit to 10 jobs
    if (isPremium !== 'true') {
      jobs = jobs.slice(0, 10);
    }

    const result = { jobs, total: jobs.length };
    cache.set(cacheKey, { data: result, timestamp: Date.now() });
    res.json(result);
  } catch (e) {
    console.error("Adzuna error:", e);
    res.status(500).json({ error: "Job search failed" });
  }
});

// Govt site link builder
app.get('/api/govt-links', (req, res) => {
  const { keyword = 'developer' } = req.query;
  const encodedKeyword = encodeURIComponent(keyword);
  
  res.json({
    canada: `https://www.jobbank.gc.ca/jobsearch/jobsearch?searchstring=${encodedKeyword}&locationstring=Canada&fws=2&fcp=1`,
    eu: `https://ec.europa.eu/eures/portal/jv-search/search?keyword=${encodedKeyword}&location=&thirdCountry=true`,
    australia: `https://jobsearch.gov.au/Search/Results?keywords=${encodedKeyword}&workRights=OverseasApplicants`,
    singapore: `https://www.mycareersfuture.gov.sg/search?query=${encodedKeyword}&isForeigner=true`
  });
});

// VPN check endpoint (for login)
app.post('/api/check-vpn', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const isSuspicious = await isSuspiciousIP(ip);
  res.json({ isSuspicious });
});

// Serve main pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/results', (req, res) => res.sendFile(path.join(__dirname, 'public', 'results.html')));
app.get('/premium', (req, res) => res.sendFile(path.join(__dirname, 'public', 'premium.html')));
app.get('/thank-you', (req, res) => res.sendFile(path.join(__dirname, 'public', 'thank-you.html')));

app.listen(PORT, () => {
  console.log(`Job Sponsored running on port ${PORT}`);
});
