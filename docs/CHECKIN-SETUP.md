# Driver check-in: one-time setup (about 10 minutes)

This connects the route sheets app to a Google Sheet in **TABLE's own Google account**. After setup:

- Every printed route sheet gets a green **Check in deliveries** QR code.
- Drivers scan it, tap **Start route**, then **Delivered** or **Problem** at each stop, and can add a photo. Nothing to install.
- Every tap lands in the Sheet with the time it was tapped. Photos go into a private Drive folder.
- Apartment building pins are shared, so every computer that runs the app sees the same setup.

All of this lives in TABLE's Google account. The student team, GitHub and anyone else never receive it.

You need: a TABLE Google account (ideally a shared one like deliveries@…, not a personal one), and a computer.

## 1. Make the Sheet

1. Go to [sheets.new](https://sheets.new) while signed in to the TABLE Google account.
2. Name it **TABLE Deliveries**.

## 2. Add the script

1. In the Sheet: **Extensions → Apps Script**.
2. Delete everything in the editor.
3. Open [`apps-script/Code.gs`](../apps-script/Code.gs), copy all of it, and paste it into the editor.
4. Click **Save** (the disk icon).

## 3. Run setup once

1. In the toolbar, pick **setup** in the function list, then click **Run**.
2. Google asks for permission. Click **Review permissions**, choose the TABLE account, then **Advanced → Go to (project name) (unsafe) → Allow**.
   Google shows "unsafe" for every script it hasn't reviewed. This one only touches this Sheet, one Drive folder and one Drive file.
3. Open **View → Logs** (or the Execution log at the bottom). Copy the **key** it printed. You need it in step 5.

Setup made: a **Deliveries** tab in the Sheet, a **TABLE delivery photos** folder and a **TABLE shared places.json** file in Drive.

## 4. Publish it as a web app

1. Click **Deploy → New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**.
   "Anyone" is needed so drivers' phones can send taps without signing in. The key from step 3 protects it: without the key, nothing is read or written.
4. Click **Deploy**, then copy the **Web app URL** (it ends in `/exec`).

## 5. Connect the app

1. Open the route sheets app and go to **Print & send**.
2. Open **Settings → Driver check-in and shared building pins**.
3. Paste the Web app URL and the key, then click **Test and save**.
4. Print the sheets. Each one now has the green **Check in deliveries** code.

Do step 5 on every computer that runs the app. They all use the same URL and key.

## Reading the results

Open the **Deliveries** tab. One row per tap:

| Column | Meaning |
|---|---|
| Tapped at | When the driver tapped (phone time, UTC). Taps made with no signal keep their real time and arrive later. |
| Week of / Day / Route / Stop # | Which delivery |
| What | Started route, Delivered, Problem, Photo, Finished route |
| Problem / Note | What the driver picked and typed |
| Photo | Link to the photo in the Drive folder |
| Phone ID | A random ID per phone, so you can tell drivers' phones apart. No names. |

Tips:
- Filter **What = Problem** to see stops to follow up on.
- "Started route" to "Finished route" for a route gives its real drive time. After a few weeks, compare it with the app's estimates.
- If a driver taps twice, the latest tap is the one that counts.

## Questions TABLE should decide

- **Photos:** keep them optional, require them, or turn them off? (Right now they're optional.) How long to keep them? Delete old photos from the Drive folder whenever you like.
- **Who can open the Sheet:** share it only with staff who need it.

## If something goes wrong

- **"TABLE's sheet did not accept the key"**: the key in the app doesn't match. Run `setup` again and copy the key from the log.
- **Changed the script?** Use **Deploy → Manage deployments → Edit → Version: New version**, so the URL stays the same.
- **Key leaked, or a driver keeps sending junk:** run `newKey` in the Apps Script editor, paste the new key into the app, and print new sheets. Old sheets stop working.
- **Driver has no signal:** taps wait on the phone and send by themselves when signal comes back, as long as they open the page again.
- **Two computers edit the same complex at the same time:** the one saved last wins. This depends on each computer's clock being right.
