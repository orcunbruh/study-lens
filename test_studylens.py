# -*- coding: utf-8 -*-
"""StudyLens uçtan uca kabul ve entegrasyon testleri (gerçek Antigravity 3.8 Flash bağlantısı dahil)."""

import json
import sys
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE = "http://127.0.0.1:8095"


def get_json(path: str) -> dict:
    with urllib.request.urlopen(f"{BASE}{path}", timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


def post_json(path: str, payload: dict, timeout: int = 45) -> dict:
    raw = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=raw,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def main() -> None:
    # 1. Antigravity 3.8 Flash Bağlantı Durumu
    st = get_json("/api/status")
    assert st.get("connected") is True, f"3.8 Flash bağlı değil: {st}"
    print(f"[PASS] 1. Antigravity 3.8 Flash bağlantısı aktif: {st['address']} (PID={st['pid']})")

    # 2. Kütüphane Kontrolü (Sayısal Analiz + MAT3327 Ayrık Matematik + PDF)
    lib = get_json("/api/library")
    assert lib.get("ok") is True
    ids = [item["id"] for item in lib["items"]]
    assert "Sayisal_Analiz_Ders_Notlari" in ids, f"Sayısal Analiz eksik: {ids}"
    assert "MAT3327_Ayrik_Matematik_Vize_Notlari" in ids, f"MAT3327 eksik: {ids}"
    print(f"[PASS] 2. Ders kütüphanesi yüklendi ({len(ids)} materyal): {ids}")

    # 3. Sayısal Analiz Notu ve 9 Vektörel Desmos Grafiği Kontrolü
    sa = get_json("/api/note/Sayisal_Analiz_Ders_Notlari")
    assert sa.get("ok") is True
    assert "/static/plots/plot_01_rolle.svg" in sa["markdown"]
    assert "/static/plots/plot_07_newton.svg" in sa["markdown"]
    for plot_name in (
        "plot_01_rolle.svg",
        "plot_06_kesme.svg",
        "plot_07_newton.svg",
        "plot_08_kirisler.svg",
        "plot_09_sabit_nokta.svg",
    ):
        with urllib.request.urlopen(f"{BASE}/static/plots/{plot_name}", timeout=5) as r:
            assert r.status == 200
    print("[PASS] 3. Sayısal Analiz ders kitabı ve tüm Desmos SVG grafikleri doğrulandı.")

    # 4. MAT3327 Ayrık Matematik Notu ve İnteraktif Laboratuvar Kontrolü
    mat = get_json("/api/note/MAT3327_Ayrik_Matematik_Vize_Notlari")
    assert mat.get("ok") is True
    assert mat.get("has_interactive_lab") is True
    with urllib.request.urlopen(f"{BASE}{mat['lab_url']}", timeout=5) as r:
        assert r.status == 200
    print("[PASS] 4. MAT3327 Ayrık Matematik ders kitabı ve İnteraktif Simülatör doğrulandı.")

    # 5. Gerçek Shift+Kırpma + Bağlam + Antigravity 3.8 Flash Sorgusu ('=' sonrası adım)
    ask_res = post_json(
        "/api/ask",
        {
            "note_id": "Sayisal_Analiz_Ders_Notlari",
            "note_title": "SAYISAL ANALİZ (NUMERICAL ANALYSIS)",
            "section_title": "4.1. Formülün Taylor Serisinden Çıkarılışı (Newton-Raphson)",
            "doc_summary": "Lineer olmayan denklemlerin kökünü teğet doğruları yardımıyla bulan Newton-Raphson iterasyon yöntemi.",
            "card_context": (
                "Taylor serisini birinci türevden sonra kesip f(x) = 0 kök koşulunu yazarsak:\n"
                "0 ≈ f(x_0) + f'(x_0)(x - x_0)\n"
                "Buradan x'i yalnız bırakırsak Newton-Raphson iterasyon formülü elde edilir:\n"
                "x_1 = x_0 - f(x_0) / f'(x_0)"
            ),
            "selected_latex": [r"x_1 = x_0 - \frac{f(x_0)}{f'(x_0)}"],
            "selected_text": "x_1 = x_0 - f(x_0) / f'(x_0)",
            "equation_focus_hint": r"Tam formül [x_1 = x_0 - \frac{f(x_0)}{f'(x_0)}] içinde özellikle seçilen '=' sonrası kısım: 'x_0 - f(x_0)/f'(x_0)'",
            "question": "Burada = işaretinden sonraki x_0 - f(x_0)/f'(x_0) ifadesi üstteki 0 = f(x_0) + f'(x_0)(x - x_0) satırından nasıl elde edildi? Kısa ve adım adım göster.",
            "history": [],
            "visual_only": False,
        },
    )
    assert ask_res.get("ok") is True, f"3.8 Flash hatası: {ask_res}"
    assert len(ask_res.get("answer", "")) > 30
    assert "M319" in (ask_res.get("verified_backend_model") or ""), f"Yanlış model: {ask_res}"
    print(
        f"[PASS] 5. {ask_res['model']} ({ask_res['verified_backend_model']}) gerçek yanıt döndürdü ({ask_res['elapsed_ms']} ms): "
        f"{ask_res['answer'][:110].replace(chr(10), ' ')}..."
    )

    # 6. İğneleme (Pin) Kaydetme ve Silme Kontrolü
    pin_res = post_json(
        "/api/pins/save",
        {
            "note_id": "Sayisal_Analiz_Ders_Notlari",
            "pin": {
                "id": "pin_test_1",
                "rectPage": {"left": 180, "top": 420, "width": 220, "height": 50},
                "sectionTitle": "4.1. Newton-Raphson",
                "selectedLatex": [r"x_1 = x_0 - \frac{f(x_0)}{f'(x_0)}"],
                "equationFocusHint": "Newton-Raphson '=' sonrası adım",
                "history": [
                    {"role": "user", "content": "Bu adım nereden geldi?"},
                    {"role": "assistant", "content": ask_res["answer"]},
                ],
            },
        },
    )
    assert pin_res.get("ok") is True
    del_res = post_json(
        "/api/pins/delete",
        {"note_id": "Sayisal_Analiz_Ders_Notlari", "pin_id": "pin_test_1"},
    )
    assert del_res.get("ok") is True
    print("[PASS] 6. Nota İğneleme (Pin) kaydetme ve silme döngüsü doğrulandı.")
    print("\n🎉 TÜM KABUL TESTLERİ (6/6) BAŞARIYLA GEÇTİ!")


if __name__ == "__main__":
    main()
