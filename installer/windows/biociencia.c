/*
 * BioCiencia.exe — lanzador de BioCiencia para Windows (sin Node.js ni otras dependencias).
 *
 *  - Sirve la aplicación compilada (carpeta «app» junto al ejecutable) SOLO en 127.0.0.1:5173.
 *    Es la misma dirección que usaba «Iniciar BioCiencia.cmd», así los datos guardados en el navegador
 *    se siguen viendo, y la que acepta Ollama por defecto para la IA local.
 *  - Abre BioCiencia en el navegador predeterminado (o en una ventana propia de Edge con --ventana).
 *  - Queda un ícono junto al reloj de Windows para volver a abrir o salir.
 *  - Seguridad: solo GET/HEAD, sin rutas fuera de «app», cabecera Host obligatoria (evita «DNS rebinding»).
 *
 * Compilar (desde Linux o Windows con MinGW-w64):
 *   x86_64-w64-mingw32-windres recursos.rc -O coff -o recursos.o
 *   x86_64-w64-mingw32-gcc -O2 -municode -mwindows biociencia.c recursos.o -o BioCiencia.exe -lws2_32 -lshell32 -luser32
 * Licencia MIT (igual que BioCiencia).
 */
#define WIN32_LEAN_AND_MEAN
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <shellapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#define PORT 5173
#define WM_TRAY (WM_APP + 1)
#define ID_OPEN 1001
#define ID_WINDOW 1002
#define ID_QUIT 1003
#define MAX_REQ 8192

static wchar_t g_root[MAX_PATH];     /* ...\app */
static char g_root_utf8[MAX_PATH * 3];
static NOTIFYICONDATAW g_nid;
static HINSTANCE g_inst;
static const wchar_t *URL = L"http://127.0.0.1:5173/";

/* ------------------------------------------------------------------ navegador */

static void open_browser(int app_window) {
    if (app_window) {
        /* Ventana propia (sin pestañas) con Microsoft Edge, presente en Windows 10 y 11 */
        HINSTANCE r = ShellExecuteW(NULL, L"open", L"msedge.exe", L"--app=http://127.0.0.1:5173/", NULL, SW_SHOWNORMAL);
        if ((INT_PTR)r > 32) return;
    }
    ShellExecuteW(NULL, L"open", URL, NULL, NULL, SW_SHOWNORMAL);
}

/* ------------------------------------------------------------------ servidor HTTP */

static const char *mime_of(const char *path) {
    const char *dot = strrchr(path, '.');
    if (!dot) return "application/octet-stream";
    if (!_stricmp(dot, ".html")) return "text/html; charset=utf-8";
    if (!_stricmp(dot, ".js") || !_stricmp(dot, ".mjs")) return "text/javascript; charset=utf-8";
    if (!_stricmp(dot, ".css")) return "text/css; charset=utf-8";
    if (!_stricmp(dot, ".json")) return "application/json";
    if (!_stricmp(dot, ".webmanifest")) return "application/manifest+json";
    if (!_stricmp(dot, ".wasm")) return "application/wasm";
    if (!_stricmp(dot, ".svg")) return "image/svg+xml";
    if (!_stricmp(dot, ".png")) return "image/png";
    if (!_stricmp(dot, ".ico")) return "image/x-icon";
    if (!_stricmp(dot, ".txt")) return "text/plain; charset=utf-8";
    if (!_stricmp(dot, ".csl") || !_stricmp(dot, ".xml")) return "application/xml";
    return "application/octet-stream";
}

static int hexval(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

/* Decodifica %xx; rechaza bytes de control, «\» y «..» (nunca se sale de la carpeta app). */
int clean_path(const char *in, char *out, size_t outsz) {
    size_t o = 0;
    const char *p = in;
    if (*p != '/') return 0;
    while (*p && *p != '?' && *p != '#') {
        char c = *p;
        if (c == '%') {
            int a = hexval(p[1]), b = a >= 0 ? hexval(p[2]) : -1;
            if (a < 0 || b < 0) return 0;
            c = (char)(a * 16 + b);
            p += 3;
        } else p++;
        if ((unsigned char)c < 0x20 || c == '\\' || c == ':') return 0;
        if (o + 1 >= outsz) return 0;
        out[o++] = c;
    }
    out[o] = 0;
    if (strstr(out, "..") || strstr(out, "//")) return 0;
    if (strcmp(out, "/") == 0) {
        if (outsz < 12) return 0;
        strcpy(out, "/index.html");
    }
    return 1;
}

static void send_all(SOCKET s, const char *buf, int len) {
    while (len > 0) {
        int n = send(s, buf, len, 0);
        if (n <= 0) return;
        buf += n;
        len -= n;
    }
}

static void send_simple(SOCKET s, int code, const char *status, const char *body) {
    char head[512];
    int n = snprintf(head, sizeof head,
                     "HTTP/1.1 %d %s\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: %d\r\n"
                     "X-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n%s",
                     code, status, (int)strlen(body), body);
    send_all(s, head, n);
}

/* ¿La cabecera Host es la nuestra? (127.0.0.1:5173 o localhost:5173) */
int host_ok(const char *req) {
    const char *h = req;
    while ((h = strstr(h, "\r\n")) != NULL) {
        h += 2;
        if (_strnicmp(h, "Host:", 5) == 0) {
            h += 5;
            while (*h == ' ' || *h == '\t') h++;
            return _strnicmp(h, "127.0.0.1:5173\r", 15) == 0 || _strnicmp(h, "localhost:5173\r", 15) == 0;
        }
    }
    return 0;
}

static DWORD WINAPI handle_client(LPVOID arg) {
    SOCKET s = (SOCKET)(UINT_PTR)arg;
    char req[MAX_REQ + 1];
    int got = 0;
    DWORD tmo = 10000;
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (const char *)&tmo, sizeof tmo);
    while (got < MAX_REQ) {
        int n = recv(s, req + got, MAX_REQ - got, 0);
        if (n <= 0) break;
        got += n;
        req[got] = 0;
        if (strstr(req, "\r\n\r\n")) break;
    }
    req[got] = 0;
    if (got == 0 || !strstr(req, "\r\n\r\n")) { closesocket(s); return 0; }

    int head_only = 0;
    char *path_start;
    if (strncmp(req, "GET ", 4) == 0) path_start = req + 4;
    else if (strncmp(req, "HEAD ", 5) == 0) { path_start = req + 5; head_only = 1; }
    else { send_simple(s, 405, "Method Not Allowed", "Metodo no permitido"); closesocket(s); return 0; }
    if (!host_ok(req)) { send_simple(s, 403, "Forbidden", "Host no permitido"); closesocket(s); return 0; }

    char *sp = strchr(path_start, ' ');
    if (!sp) { closesocket(s); return 0; }
    *sp = 0;
    char rel[2048];
    if (!clean_path(path_start, rel, sizeof rel)) { send_simple(s, 404, "Not Found", "No encontrado"); closesocket(s); return 0; }

    char full[MAX_PATH * 3 + 2048];
    snprintf(full, sizeof full, "%s%s", g_root_utf8, rel);
    for (char *q = full; *q; q++) if (*q == '/') *q = '\\';
    wchar_t wfull[MAX_PATH * 2];
    if (!MultiByteToWideChar(CP_UTF8, 0, full, -1, wfull, MAX_PATH * 2)) { send_simple(s, 404, "Not Found", "No encontrado"); closesocket(s); return 0; }

    HANDLE f = CreateFileW(wfull, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (f == INVALID_HANDLE_VALUE) { send_simple(s, 404, "Not Found", "No encontrado"); closesocket(s); return 0; }
    BY_HANDLE_FILE_INFORMATION info;
    if (!GetFileInformationByHandle(f, &info) || (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) {
        CloseHandle(f);
        send_simple(s, 404, "Not Found", "No encontrado");
        closesocket(s);
        return 0;
    }
    unsigned long long size = ((unsigned long long)info.nFileSizeHigh << 32) | info.nFileSizeLow;
    const char *cache = (strstr(rel, ".html") || strstr(rel, "sw.js")) ? "no-cache" : "public, max-age=31536000, immutable";
    char head[768];
    int n = snprintf(head, sizeof head,
                     "HTTP/1.1 200 OK\r\nContent-Type: %s\r\nContent-Length: %llu\r\nX-Content-Type-Options: nosniff\r\n"
                     "Referrer-Policy: no-referrer\r\nCache-Control: %s\r\nConnection: close\r\n\r\n",
                     mime_of(rel), size, cache);
    send_all(s, head, n);
    if (!head_only) {
        char *buf = (char *)malloc(65536);
        DWORD rd;
        if (buf) {
            while (ReadFile(f, buf, 65536, &rd, NULL) && rd > 0) send_all(s, buf, (int)rd);
            free(buf);
        }
    }
    CloseHandle(f);
    shutdown(s, SD_SEND);
    closesocket(s);
    return 0;
}

static DWORD WINAPI server_loop(LPVOID arg) {
    SOCKET ls = (SOCKET)(UINT_PTR)arg;
    for (;;) {
        SOCKET c = accept(ls, NULL, NULL);
        if (c == INVALID_SOCKET) continue;
        HANDLE t = CreateThread(NULL, 0, handle_client, (LPVOID)(UINT_PTR)c, 0, NULL);
        if (t) CloseHandle(t); else closesocket(c);
    }
    return 0;
}

/* ¿Ya hay una BioCiencia escuchando en el puerto? */
static int already_running(void) {
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) return 0;
    struct sockaddr_in a = {0};
    a.sin_family = AF_INET;
    a.sin_port = htons(PORT);
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (connect(s, (struct sockaddr *)&a, sizeof a) != 0) { closesocket(s); return 0; }
    const char *q = "GET /index.html HTTP/1.1\r\nHost: 127.0.0.1:5173\r\nConnection: close\r\n\r\n";
    send(s, q, (int)strlen(q), 0);
    char buf[4096];
    int got = 0, n;
    while (got < (int)sizeof buf - 1 && (n = recv(s, buf + got, sizeof buf - 1 - got, 0)) > 0) got += n;
    buf[got] = 0;
    closesocket(s);
    return strstr(buf, "BioCiencia") != NULL;
}

/* ------------------------------------------------------------------ ícono junto al reloj */

static LRESULT CALLBACK wnd_proc(HWND h, UINT m, WPARAM w, LPARAM l) {
    if (m == WM_TRAY && (LOWORD(l) == WM_RBUTTONUP || LOWORD(l) == WM_LBUTTONUP)) {
        if (LOWORD(l) == WM_LBUTTONUP) { open_browser(0); return 0; }
        POINT pt;
        GetCursorPos(&pt);
        HMENU menu = CreatePopupMenu();
        AppendMenuW(menu, MF_STRING, ID_OPEN, L"Abrir BioCiencia");
        AppendMenuW(menu, MF_STRING, ID_WINDOW, L"Abrir en ventana propia (Edge)");
        AppendMenuW(menu, MF_SEPARATOR, 0, NULL);
        AppendMenuW(menu, MF_STRING, ID_QUIT, L"Salir de BioCiencia");
        SetForegroundWindow(h);
        TrackPopupMenu(menu, TPM_RIGHTBUTTON, pt.x, pt.y, 0, h, NULL);
        DestroyMenu(menu);
        return 0;
    }
    if (m == WM_COMMAND) {
        if (LOWORD(w) == ID_OPEN) open_browser(0);
        if (LOWORD(w) == ID_WINDOW) open_browser(1);
        if (LOWORD(w) == ID_QUIT) { Shell_NotifyIconW(NIM_DELETE, &g_nid); PostQuitMessage(0); }
        return 0;
    }
    if (m == WM_DESTROY) { Shell_NotifyIconW(NIM_DELETE, &g_nid); PostQuitMessage(0); return 0; }
    return DefWindowProcW(h, m, w, l);
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE prev, PWSTR cmd, int show) {
    (void)prev; (void)show;
    g_inst = inst;
    int app_window = cmd && wcsstr(cmd, L"--ventana") != NULL;
    int no_browser = cmd && wcsstr(cmd, L"--sin-navegador") != NULL;

    /* Carpeta app junto al ejecutable */
    GetModuleFileNameW(NULL, g_root, MAX_PATH);
    wchar_t *slash = wcsrchr(g_root, L'\\');
    if (slash) *(slash + 1) = 0;
    wcscat(g_root, L"app");
    WideCharToMultiByte(CP_UTF8, 0, g_root, -1, g_root_utf8, sizeof g_root_utf8, NULL, NULL);
    wchar_t index[MAX_PATH + 16];
    swprintf(index, MAX_PATH + 16, L"%ls\\index.html", g_root);
    if (GetFileAttributesW(index) == INVALID_FILE_ATTRIBUTES) {
        MessageBoxW(NULL, L"No se encuentra la carpeta «app» con la aplicación. Vuelva a instalar BioCiencia.", L"BioCiencia", MB_ICONERROR);
        return 1;
    }

    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return 1;

    /* Una sola copia: si ya está abierta, solo se abre el navegador */
    HANDLE mutex = CreateMutexW(NULL, TRUE, L"Local\\BioCiencia-servidor");
    if (GetLastError() == ERROR_ALREADY_EXISTS || already_running()) {
        if (!no_browser) open_browser(app_window);
        return 0;
    }

    SOCKET ls = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    BOOL excl = TRUE;
    setsockopt(ls, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, (const char *)&excl, sizeof excl);
    struct sockaddr_in a = {0};
    a.sin_family = AF_INET;
    a.sin_port = htons(PORT);
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK); /* solo esta computadora */
    if (bind(ls, (struct sockaddr *)&a, sizeof a) != 0 || listen(ls, SOMAXCONN) != 0) {
        MessageBoxW(NULL,
                    L"El puerto 5173 está ocupado por otro programa (¿quedó abierta la ventana negra de «Iniciar BioCiencia.cmd» o «npm run dev:web»?).\n\nCiérrelo y vuelva a abrir BioCiencia.",
                    L"BioCiencia", MB_ICONWARNING);
        return 1;
    }
    HANDLE th = CreateThread(NULL, 0, server_loop, (LPVOID)(UINT_PTR)ls, 0, NULL);
    if (!th) return 1;

    WNDCLASSW wc = {0};
    wc.lpfnWndProc = wnd_proc;
    wc.hInstance = inst;
    wc.lpszClassName = L"BioCienciaBandeja";
    RegisterClassW(&wc);
    HWND hwnd = CreateWindowW(wc.lpszClassName, L"BioCiencia", 0, 0, 0, 0, 0, HWND_MESSAGE, NULL, inst, NULL);

    g_nid.cbSize = sizeof g_nid;
    g_nid.hWnd = hwnd;
    g_nid.uID = 1;
    g_nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP | NIF_INFO;
    g_nid.uCallbackMessage = WM_TRAY;
    g_nid.hIcon = LoadIconW(inst, MAKEINTRESOURCEW(1));
    if (!g_nid.hIcon) g_nid.hIcon = LoadIconW(NULL, IDI_APPLICATION);
    wcscpy(g_nid.szTip, L"BioCiencia (clic: abrir · clic derecho: salir)");
    wcscpy(g_nid.szInfoTitle, L"BioCiencia está abierta");
    wcscpy(g_nid.szInfo, L"Para cerrarla, clic derecho en este ícono → Salir.");
    g_nid.dwInfoFlags = NIIF_INFO;
    Shell_NotifyIconW(NIM_ADD, &g_nid);

    if (!no_browser) open_browser(app_window);

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    closesocket(ls);
    WSACleanup();
    if (mutex) CloseHandle(mutex);
    return 0;
}
