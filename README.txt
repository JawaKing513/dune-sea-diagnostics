Dune Sea Diagnostics — Static Website Starter
===========================================

What this is
------------
A simple static website (HTML/CSS/JS) you can host anywhere.

It includes:
- Inventory section (7 filler listings, currently unavailable)
- Appointment request scheduler (week view)
- Admin mode:
  - Accept / Reject appointment requests
  - Block / Unblock time slots
  - Block a whole day
- About + Contact sections
- Photo folders you can fill

IMPORTANT LIMITATION (for now)
------------------------------
The scheduler stores data in THIS BROWSER (localStorage). That means:
- If you open the site on another device, it won't see the same requests.
- When you're ready, we can upgrade this to a real backend (email/SMS + shared database).

How to run locally
------------------
Option 1: just double-click index.html (works in most browsers)
Option 2 (recommended): use a tiny local web server:
  - VS Code Live Server extension
  - or python:
      python -m http.server 8080
    then open http://localhost:8080

Photos
------
Drop your images into:
- assets/photos/jobs/        (repair job photos)
- assets/photos/inventory/   (inventory listing photos)

Then update the list of gallery images in:
- assets/js/app.js -> renderGallery()

Admin PIN
---------
Change the PIN here:
- assets/js/app.js -> ADMIN_PIN

Business info
-------------
Edit defaults here:
- assets/js/app.js -> DEFAULT_STATE.business

Reset
-----
Admin panel includes a "Reset Local Data" button (this browser only).

Next steps (when you're ready)
------------------------------
- Real booking system (shared database)
- Email/SMS confirmations + reminders
- Upload photo support (customer can attach model/serial & issue photos)
- Stripe deposits to reduce no-shows


v3 note: same theme as original, separated into pages (info/inventory/schedule). index.html = info.


Inventory management (v7)
- Open inventory.html
- Click Manage (Admin PIN)
- Use the Manage Inventory panel to add/edit/delete items.
Fields: Title, Model #, Buy price, Rent price, Status, Photo path, Notes.
