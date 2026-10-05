# SEN Android build from an Android phone

You do not need Android Studio on the phone if you use the included GitHub Actions workflow.

## 1. Put SEN on GitHub
Upload the SEN project to a GitHub repository. Do not upload `.env` or private keys.

## 2. Configure the Android backend URL

In GitHub, open **Settings → Secrets and variables → Actions → Variables** and add a repository variable named `SEN_API_URL` containing your deployed HTTPS Render URL (for example `https://sen-api.onrender.com`). The Android workflows require this variable so the APK knows which backend to use.

## 3. Build a test APK
Open the repository on GitHub, go to **Actions**, select **Build SEN Android APK**, choose **Run workflow**, and wait for it to finish.

Open the workflow run and download the `sen-debug-apk` artifact. Install the APK on your Android phone for testing. Android may ask you to allow installation from that source.

## 4. Build a Play Store bundle
Use **Build SEN Android AAB** from Actions. This creates an unsigned AAB for the release pipeline.

For a real Play Store release, configure Android app signing/keystore secrets and sign the AAB. Do not commit the keystore to GitHub.

## 5. Important production setting
The Android app needs to communicate with the deployed SEN HTTPS URL. The current Capacitor app is designed to use the bundled web app; if you later move the frontend to a separate domain, update the app configuration accordingly.
