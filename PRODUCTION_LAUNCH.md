# SEN Production Launch Checklist

## Required external services
1. Production HTTPS domain (set `PUBLIC_APP_URL` on Render)
2. Managed PostgreSQL (or equivalent)
3. S3-compatible object storage + CDN for videos
4. TURN server for reliable WebRTC calls
5. Firebase Cloud Messaging for Android notifications
6. Google Play Console developer account

## Security
- Generate a unique JWT_SECRET.
- Store all secrets in the hosting provider's secret/environment manager.
- Do not commit `.env`.
- Use HTTPS in production.
- Restrict upload MIME types and file sizes.
- Rate-limit login, messaging, comments, likes, follows, and reports.
- Add account deletion and data-export flows before public launch.

## Video moderation
- Reports should enter an admin review queue.
- Admin actions: hide, restore, delete, suspend user.
- Keep an audit log for moderation actions.
- Consider automated scanning before public scale.

## Release
- Set the GitHub Actions repository variable `SEN_API_URL` to the Render HTTPS service URL.
- Build Android AAB with Capacitor/Android Studio; the app bundles its UI locally and uses `SEN_API_URL` for backend traffic.
- Test on multiple Android versions and networks.
- Configure Play Console app signing.
