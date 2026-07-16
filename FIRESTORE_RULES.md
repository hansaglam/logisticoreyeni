# Firestore Security Rules — LogistiCore

Bu kurallar Firebase Console üzerinden deploy edilmelidir.
Şu an tüm kullanıcı verisi private tutulur; leaderboard gibi public koleksiyonlar eklendiğinde ayrı rules yazılacaktır.

```txt
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, create, update, delete: if request.auth != null && request.auth.uid == userId;

      match /saves/{saveId} {
        allow read, create, update, delete: if request.auth != null && request.auth.uid == userId;
      }

      match /meta/{docId} {
        allow read, create, update, delete: if request.auth != null && request.auth.uid == userId;
      }
    }
  }
}
```

## Notlar

- Authentication + Firestore Security Rules birlikte kullanılmalıdır.
- Client-side Firebase config değerleri public kabul edilir; secret olarak saklanmaz.
- Public leaderboard eklendiğinde `leaderboards/{...}` gibi ayrı koleksiyon ve ayrı read rules tanımlanacak.
- Cloud Functions bu fazda kullanılmıyor; tüm erişim istemci Auth + rules ile sınırlı.
