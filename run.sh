#!/bin/bash
# StudyLens - macOS / Linux Başlatıcı
cd "$(dirname "$0")"

echo "================================================"
echo " StudyLens — macOS Başlatıcı (Antigravity 3.8 Flash)"
echo "================================================"

# Python3 kontrolü
if ! command -v python3 &> /dev/null; then
    echo "Hata: python3 bulunamadı. Lütfen Python yükleyin."
    exit 1
fi

echo "Sunucu başlatılıyor... (Tarayıcı açılıyor)"
# Arka planda 1.5 sn sonra tarayıcıyı aç
(sleep 1.5 && open "http://localhost:8095" 2>/dev/null || true) &

# Sunucuyu çalıştır
python3 server.py
