process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function inspectEndpoints() {
  const jsRes = await fetch('https://www.smsreminder.co/assets/index-BErxHrxh.js');
  const js = await jsRes.text();
  
  // Search for firebaseConfig or API URLs
  const firebaseRegex = /https:\/\/[a-zA-Z0-9\.\-_]+(?:firebaseio|cloudfunctions|googleapis|smsreminder|recordatorio)[a-zA-Z0-9\.\-_\/]+/gi;
  const matches = js.match(firebaseRegex) || [];
  console.log('Matches:', [...new Set(matches)]);

  // Look for firestore / collection names
  const collectionRegex = /collection\([a-zA-Z0-9_]+,\s*["']([a-zA-Z0-9_-]+)["']\)/gi;
  let cMatch;
  const collections = [];
  while ((cMatch = collectionRegex.exec(js)) !== null) {
    collections.push(cMatch[1]);
  }
  console.log('Collections:', [...new Set(collections)]);
}

inspectEndpoints().catch(console.error);
