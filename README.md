# Hedef Önce — gerçek veri başlangıcı

Bu sürüm, seçilen **Karar Odaklı** arayüzü API anahtarı istemeyen gerçek piyasa veri toplayıcısına bağlar. Emir göndermez; canlı araştırma skoru üretir.
Canlı prediction motoru sabit kurallı araştırma skoru üretir; walk-forward kalibrasyonu tamamlanana kadar kazanma olasılığı üretmez ve bütün adayları paper araştırmasıyla sınırlar.

Arayüzde her teknik verinin yanında günlük Türkçe karşılığı bulunur. Üstteki **“Şimdi ne yapmalıyım?”** kartı kararı `İşlem açma`, `Şimdilik bekle` veya `Sadece paper takip et` olarak söyler ve değişmesi beklenen şartları listeler. Bu metinler sinyal kaydına da yazıldığı için ileride aynı açıklamalar bildirimlerde kullanılabilir.

## Kısa vadeli giriş zamanlaması

Prediction motoru artık günlük hisse yönünü ana karar olarak kullanmaz. +%1/+%1,5 hedefi için tamamlanmış 5 dakikalık mumlarda satış sonrası dönüşü, kısa ortalama ivmesini, yükselen dip veya üç mumluk kırılımı, yakın desteğe göre stop uzaklığını ve hedefe tahmini süreyi birlikte ölçer. Memory, sektör, makro ve haber katmanları bağlam ve risk uyarısıdır; güçlü bir yakın dönem tetiğini tek başına iptal etmez. Arayüz `Giriş penceresi: Açık / Hazırlanıyor / Kapalı / Engelli` ve `Taktik risk: Düşük / Orta / Yüksek` alanlarını gösterir.

## Çalıştırma

Node.js 20 veya üzeri gerekir. Ek paket kurulmaz.

```powershell
cd C:\Users\USER\Documents\Codex\2026-10-08\referenced-chatgpt-conversation-this-is-an\outputs\hedef-once-app
npm start
```

Ardından `http://127.0.0.1:4173` adresi açılır. Program açık kaldığı sürece veri yaklaşık dakikada bir yenilenir.

Tek sefer veri toplamak için:

```powershell
npm run collect
```

Doğrulamalar:

```powershell
npm test
```

Point-in-time veri ve sinyal birikimini denetlemek için:

```powershell
npm run audit
```

## Şu anda alınan gerçek veriler

- Ana hisseler: MU, SNDK
- Memory: WDC, STX
- Semiconductor ve ekipman: NVDA, AMD, AVGO, AMAT, LRCX, ASML
- ETF ve piyasa: SMH, SOXX, QQQ, SPY
- Makro proxy'leri: VIX, ABD 10 yıllık, DXY, Nasdaq ve S&P vadeli işlemleri
- Bir dakikalık fiyat/hacim barları, extended-hours dahil
- MU/SNDK gerçek zamanlı bid, ask, büyüklük ve spread
- MU/SNDK ve memory teması için canlı haber RSS akışı
- MU/SNDK resmi SEC bildirimleri ve kabul zamanları
- Önümüzdeki sekiz günlük ABD ekonomik takvimi
- Önümüzdeki sekiz günlük MU/SNDK bilanço takvimi kontrolü

Kaynak profili `NO_KEY_PUBLIC_RESEARCH` olarak işaretlenir. Bu bağlantı anahtarsız ve garanti edilmeyen kamu erişimine dayanır. Veri gecikmesi ve başarısız semboller arayüzde görünür tutulur.

## Point-in-time kayıt

- `data/bars/*.ndjson`: normalize edilmiş bar kayıtları
- `data/snapshots/YYYY-MM-DD.ndjson`: her toplama anındaki piyasa görünümü
- `data/latest.json`: arayüzün kullandığı son snapshot
- `data/context/*.ndjson`: haber, SEC ve takvim snapshot'ları
- `data/latest-context.json`: son bağlam snapshot'ı
- `data/state.json`: yinelenen barları engelleyen kolektör durumu

İlk çalıştırmada geçmişten indirilen barlar `BACKFILL_OBSERVED_NOW` olarak işaretlenir. Bunlar o geçmiş tarihte sisteme gerçekten ulaşmış point-in-time kayıt sayılmaz. Program çalışırken yeni gözlenen barlar `OBSERVED_LIVE` olarak kaydedilir.

## Neden skor kapalı?

Fiyat katmanı tek başına Memory Momentum Long Engine v0.1'i temsil etmez. Şu katmanlar tamamlanana kadar ekran işlem puanı veya hedef-önce-stop olasılığı üretmez:

- tarihsel olarak lisanslı haber arşivi ve revizyon geçmişi
- dondurulmuş haber/olay risk sınıflandırması
- doğrulanmış uygulanabilir fill ve slippage modeli
- dondurulmuş skor ve veto kuralları
- walk-forward ile kalibrasyon

Bu sınır arayüzde “Eksik veri katmanları” olarak gösterilir.

## Prediction ve tarafsız backtest sınırı

- Her tamamlanmış 5 dakikalık bar için MU/SNDK × Hızlı +1/Geniş +1,5 adayları oluşturulur.
- Skorun sekiz katmanı, giriş/target/stop, maliyet sonrası hedef ve bütün veto nedenleri sinyal kaydına yazılır.
- `pTargetFirst`, `pStopFirst` ve `pTimeout` kalibrasyon öncesinde daima `null` kalır.
- Strateji sinyal dosyalarını; evaluator ise yalnızca sonradan gelen barları okur.
- Aynı mumda hedef ve stop görülürse ana sonuç konservatif olarak `STOP_FIRST` olur.
- Kolektörün ilk çalışmasında geriye alınan barlar `BACKFILL_OBSERVED_NOW` olduğundan FULL_PIT haberli backtestte kullanılamaz.
- Objektif canlı-forward veri seti, kolektörün çalışmaya başladığı andan itibaren birikir.
