# Saurashtra Men's Salon — Local Wi-Fi Testing Website

This is a full local test setup with a Node.js backend, shared JSON database, customer website, admin dashboard and QR generator. Your laptop runs the server; your phone opens the same site over your Wi-Fi.

## Requirements
- Node.js 18 or newer (Node.js 20 LTS recommended)
- VS Code or another editor
- Laptop and phone connected to the same Wi-Fi

## Start on your laptop
1. Extract the ZIP.
2. Open the extracted `saurashtra-local-test` folder in VS Code.
3. Open Terminal → New Terminal.
4. Run:

   ```bash
   npm install
   npm start
   ```

5. Keep that terminal window open. The server prints a laptop address and any local Wi-Fi addresses it detects.
6. On the laptop, open `http://localhost:3000`.
7. Open `http://localhost:3000/admin` for the salon admin dashboard.

## Open on your phone
1. Connect your phone to the same Wi-Fi as your laptop.
2. On the laptop, open the admin dashboard.
3. Sign in using the test admin password `salon123`.
4. In the **Customer QR** section, choose the laptop's Wi-Fi address and click **Generate QR code**.
5. Scan the QR using your phone camera. It opens the customer website in your phone browser.
6. Keep the laptop server running while testing.

If the phone cannot connect, check that both devices are on the same Wi-Fi, disable VPN temporarily, and allow Node.js through the laptop firewall for private networks. Do not use a guest Wi-Fi network that isolates devices.

## Demo credentials
- Customer OTP: `123456` (the website displays it; no SMS is sent)
- Initial daily salon code: `4821`
- Admin password: `salon123`

The admin can rotate the daily code. Once rotated, the new code is needed for the next check-in.

## What is included
- First-time mobile OTP flow; returning customers stay logged in in that browser.
- Customer account, loyalty card, profile and visit history.
- Five stamps per card; server checks one stamp per India/IST calendar day.
- Check-in hours enforced by the server: 10:00 AM to before 11:00 PM IST.
- Three-month validity measured from the first stamp. Expired progress is archived as expired and a fresh 0/5 card is created.
- At 5/5, customer must choose exactly one reward: Basic haircut OR Beard trim / set. A completed card and redemption reference are saved, then a fresh 0/5 card begins.
- Admin customer search, totals, activity, daily-code rotation, QR generation and JSON backup export.
- No GPS or location permission.

## Data storage and reset
All test records are stored in `data.json` in this folder. Back up using the admin dashboard's **Download data backup** button. To reset all test customers, stop the server with Ctrl+C, delete `data.json`, and run `npm start` again.

## Local-test limitations — read before real use
- OTP is simulated and fixed. It is not real phone verification.
- The admin password is a local development default. Set a stronger `ADMIN_PASSWORD` environment variable before using this on a shared network.
- The check-in code is shared with customers and is suitable only for experimentation. A production version should use short-lived/rotating codes, staff verification and rate limiting.
- This server is intended for a trusted private Wi-Fi network only. It has no HTTPS, production-grade database, backups, rate limiting, CSRF protection or hardened session store.
- Do not expose port 3000 to the public internet. Do not use real customer personal data in this test build.
- Google Fonts are loaded from the internet; the site still works if unavailable, using fallback fonts.
