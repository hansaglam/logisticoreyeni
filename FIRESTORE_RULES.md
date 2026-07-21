# Firestore Security Rules — LogistiCore

Bu kurallar **Firebase Console → Firestore → Rules** ekranından deploy edilmelidir.
Bu dosya yalnızca referans dokümandır; Console’daki aktif kurallar güncellenmeden leaderboard V1 production’da güvenli çalışmaz.

## Deploy adımları

1. [Firebase Console](https://console.firebase.google.com) → projen → **Firestore Database** → **Rules**
2. Aşağıdaki bloğun tamamını yapıştır (mevcut `users` kuralları korunmuş halde)
3. **Publish** / **Deploy**

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

    match /leaderboards/{seasonId}/entries/{entryId} {
      allow read: if request.auth != null;

      allow create, update: if request.auth != null
        && request.auth.uid == entryId
        && request.auth.token.firebase.sign_in_provider != 'anonymous'
        && request.resource.data.uid == entryId
        && request.resource.data.seasonKey == seasonId
        && request.resource.data.companyName is string
        && request.resource.data.companyName.size() >= 1
        && request.resource.data.companyName.size() <= 64
        && request.resource.data.companyScore is number
        && request.resource.data.companyScore >= 0
        && request.resource.data.companyScore <= 100000000
        && request.resource.data.level is number
        && request.resource.data.level >= 1
        && request.resource.data.level <= 999
        && request.resource.data.reputation is number
        && request.resource.data.reputation >= 0
        && request.resource.data.reputation <= 100
        && request.resource.data.completedContracts is number
        && request.resource.data.completedContracts >= 0
        && request.resource.data.completedContracts <= 1000000
        && request.resource.data.seasonKey is string;

      allow delete: if request.auth != null
        && request.auth.uid == entryId
        && request.auth.token.firebase.sign_in_provider != 'anonymous';
    }
  }
}
```

## Notlar

- Authentication + Firestore Security Rules birlikte kullanılmalıdır.
- Client-side Firebase config değerleri public kabul edilir; secret olarak saklanmaz.
- **Okuma:** Yalnızca oturum açmış kullanıcılar (`request.auth != null`) leaderboard okuyabilir. Misafir (anonymous) oturum da okuyabilir; yazamaz.
- **Yazma:** Anonymous kullanıcılar server-side engellenir (`sign_in_provider != 'anonymous'`). Google/Apple bağlı hesaplar yalnızca kendi `entryId` dokümanına yazabilir.
- `leaderboards/{seasonId}/entries` koleksiyonunda `companyScore` alanına göre sıralama için Firestore composite index gerekebilir (Console otomatik link verir).
- **Hesap silme V1:** İstemci yalnızca aktif haftanın entry’sini siler (`leaderboards/weekly_{seasonKey}/entries/{uid}`).
- **Eski sezon entry temizliği (V2):** Geçmiş haftaların kayıtları otomatik silinmez. Tam GDPR temizliği için Cloud Function veya collection group delete planlanmalıdır.
- Cloud Functions bu fazda kullanılmıyor; tüm erişim istemci Auth + rules ile sınırlı.
