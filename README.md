# StudyLens 🔍⚡

**StudyLens**, ders notlarını ve PDF'leri tek bir kütüphanede toplayan; klavyeden `Shift` tuşuna basılı tutarak formülleri, grafikleri veya çözümleri ekrandan kırpıp anında **Antigravity Gemini 3.8 Flash** yapay zekasına sorabileceğin interaktif çalışma asistanıdır.

---

## 🚀 macOS Kurulum ve Çalıştırma (Arkadaşın İçin)

Arkadaşının bilgisayarında **Antigravity IDE** açık olmalıdır (arka planda Gemini 3.8 Flash yerel köprüsünü sağlar).

### 1. Projeyi İndirin / Klonlayın
```bash
git clone https://github.com/orcunbruh/study-lens.git
cd study-lens
```

### 2. Çalıştırın
Terminalden:
```bash
./run.sh
```
Veya Finder içinde **`run.command`** dosyasına çift tıklayarak doğrudan açabilirsiniz.
Tarayıcınızda otomatik olarak **`http://localhost:8095`** açılacaktır.

---

## 🪟 Windows Çalıştırma
```cmd
python server.py
```
veya `launch_studylens.vbs` dosyasına çift tıklayın.

---

## 💡 Temel Özellikler
- **Shift + Sürükle:** Ekrandaki herhangi bir denklemi/paragrafı/grafiği kırpıp doğrudan yapay zekaya sor.
- **Hızlı Çipler:** Klavyeye dokunmadan tek tıkla *"🔍 Ara adımı açıkla"*, *"⚠️ Sınav tuzağı ne?"*, *"👶 Sıfırdan anlat"*.
- **Active Recall (B tuşu):** Soru çözümlerini ve adımlarını tek tıkla bulanıklaştır, tıkla-aç yöntemiyle kendini test et.
- **Ders Notu / PDF Yükleme:** İstediğin ders notunu veya PDF'i kütüphaneye sürükle-bırak.
