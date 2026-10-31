# Style Grid — লাইভ সাইটের review snapshot

এটি Netlify-এর immutable production deploy `6ae5c0901141f86a71fe0897` (প্রকাশ: 2026-10-31 10:19:27 UTC) থেকে যাচাই করা public site files-এর review copy। Netlify record-এ deploy source ছিল CLI; commit reference ও source ZIP ছিল না। তাই এটি মূল Git source history/build project নয়—লাইভে পরিবেশিত HTML, code, data ও assets-এর snapshot।

## কী আছে

- `index.html`: live homepage-এর HTML, inline CSS ও JavaScript।
- `admin.html`, `assets/admin.css`, `assets/admin.js`, `assets/api-config.js`, `catalog-skus.json`: live admin UI, public client configuration ও lookup data।
- `products.json`, `descriptions/desc-00.json`–`desc-11.json`: ১১,১৭১টি catalog record এবং live description data।
- `assets/products/*.webp`: সব ১১,১৬৯টি referenced product image।
- `_redirects`: live-এ দেখা `/admin` → `/admin.html` route-এর সমতুল্য Netlify rewrite; এটি route behavior দেখে তৈরি helper, মূল deploy থেকে উদ্ধার করা source file নয়।
- `SHA256SUMS.txt`: snapshot ফাইলগুলোর integrity manifest।

## যাচাই ও privacy sanitation

`products.json` ও ১২টি description JSON immutable deploy থেকে byte-for-byte যাচাই করা হয়েছে। ১১,১৭১টি product record-এর ১১,১৬৯টি image path-এর সঙ্গে ছবির তালিকা মিলেছে—missing বা extra image নেই; তিনটি representative image-ও live deploy-এর সঙ্গে byte-for-byte মিলে। Homepage এবং admin assets immutable deploy URL-এর সঙ্গে মিলিয়ে দেখা হয়েছে।

লাইভ admin login form-এ account email prefilled ছিল, এবং logout-এর পর JavaScript-ও সেই ঠিকানা বসাত। Public review copy থেকে দুই জায়গার email literal মুছে খালি করা হয়েছে; live Netlify site-এ কিছু পরিবর্তন করা হয়নি। তাই `admin.html` ও `assets/admin.js` লাইভের সঙ্গে এই privacy sanitation-এ আলাদা।

`assets/api-config.js`-এ production-এর public Cloudflare Worker origin আছে: `https://style-grid-catalog-admin.mahathirmr1007.workers.dev`। এটি client-side public endpoint; কোনো API token বা password নয়। Worker-এর backend source Netlify deploy-এর অংশ নয়, তাই এখানে যোগ করা হয়নি। Netlify-র response-header policy-ও snapshot থেকে পুনরুদ্ধার করা যায়নি। পুনরায় deploy করার আগে routing, headers, API CORS ও backend behavior যাচাই করুন।

## GitHub-এ public করার আগে

এতে পুরো public catalog, product descriptions এবং ১১,১৬৯টি product photo রয়েছে। বর্ণনা ও ছবির পুনঃপ্রকাশের অধিকার নিশ্চিত করে তবেই public করুন। ZIP প্রায় ৭৫০ MB; ZIP-টিকে একক ফাইল হিসেবে GitHub repo-তে commit করবেন না (একক ফাইলের সীমা ১০০ MB)। প্রয়োজনে এই ফোল্ডারের individual files review করে repository contents হিসেবে প্রকাশ করুন; repo-টি বড় হবে।

এই review package কোনো GitHub repository তৈরি, commit, upload বা public release করেনি।
