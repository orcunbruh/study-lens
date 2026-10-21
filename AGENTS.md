# StudyLens — Bağlamsal AI Ders & Not Çalışma Merkezi (Antigravity 3.8 Flash)

## Mimari Özeti
- **Konum:** `C:\Users\Victus\.gemini\antigravity\scratch\study-lens`
- **Kaynak Notlar (Otomatik Senkron):** `C:\Users\Victus\Documents\OrcunOS\knowledge\` altındaki ders notları (`Sayisal_Analiz_Ders_Notlari.md`, `MAT3327_Ayrik_Matematik_Vize_Notlari.md` ve gelecekte eklenecek tüm ders notları) + `notes/` ve `runtime/pdfs/` dizinleri.
- **Temel Özellikler:**
  1. **Birleşik Ders Kütüphanesi & Çift Tema:** Ferah Ders Kitabı (Açık/A4) ve Gece Çalışma Modu (Koyu) arasında anlık geçiş.
  2. **Shift + Ekran Kırpıcı (Snipping Tool):** Okuyucu içinde (Markdown/LaTeX, Desmos SVG grafikleri ve PDF sayfaları üzerinde) `Shift` tuşuna basılı tutarak anlamadığın kısmı (ör. `=` sonrası işlem adımı) kutu içine alma.
  3. **Hibrit Bağlam Paketi (Context Engine):** Kırpılan bölgenin PNG görüntüsü + kutu içindeki ham LaTeX/metin + içinde bulunduğu örnek/teorem kartının tamamı + konu başlığı ve özeti otomatik birleştirilir.
  4. **Antigravity 3.8 Flash (`--model=flash`) Doğrudan Entegrasyonu:** Yerel `language_server.exe agentapi` üzerinden gerçek 3.8 Flash oturumu açar (`new-conversation` ve devam soruları için `send-message`), yanıtı `transcript_full.jsonl` üzerinden anlık okur. Simülasyon/mock kesinlikle yasaktır.
  5. **Akıllı Baloncuk & Nota İğneleme (Pin):** Kırpılan yerin yanında açılan baloncukta hızlı soru şablonları, özel soru kutusu, çok adımlı takip sohbeti (follow-up) ve açıklamayı o satıra kalıcı olarak sabitleyen **Nota İğnele** sistemi.

## Yeni Ders Notu Üretim Standardı
Orçun için üretilecek her yeni ders notu:
1. `C:\Users\Victus\Documents\OrcunOS\knowledge\<Ders_Adi>_Ders_Notlari.md` olarak kaydedilmelidir.
2. Varsa vektörel grafikleri `C:\Users\Victus\.gemini\antigravity\scratch\study-lens\static\plots\` dizinine kopyalanmalıdır.
3. Matematiksel ifadeler standart `$...$` ve `$$...$$` LaTeX bloklarıyla yazılmalıdır.
