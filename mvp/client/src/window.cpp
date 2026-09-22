#include "window.hpp"

#include <GL/glew.h>
#include <GL/wglew.h>
#include <windows.h>

#include <stdexcept>

namespace mvp::client
{

namespace
{

struct WindowUserData
{
	bool* closeRequested = nullptr;
	const std::function<void(int)>* onKeyDown = nullptr;
};

LRESULT CALLBACK windowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
	auto* userData = reinterpret_cast<WindowUserData*>(GetWindowLongPtr(hwnd, GWLP_USERDATA));

	if (message == WM_CLOSE || message == WM_DESTROY) {
		if (userData != nullptr && userData->closeRequested != nullptr) {
			*userData->closeRequested = true;
		}
		PostQuitMessage(0);
		return 0;
	}
	if (message == WM_KEYDOWN) {
		if (userData != nullptr && userData->onKeyDown != nullptr && *userData->onKeyDown) {
			(*userData->onKeyDown)(static_cast<int>(wParam));
		}
		return 0;
	}
	return DefWindowProc(hwnd, message, wParam, lParam);
}

} // namespace

Window::Window(int width, int height, const std::string& title)
{
	const HINSTANCE instance = GetModuleHandle(nullptr);

	WNDCLASS windowClass = {};
	windowClass.lpfnWndProc = windowProc;
	windowClass.hInstance = instance;
	windowClass.lpszClassName = "MvpClientWindow";
	RegisterClass(&windowClass);

	HWND hwnd = CreateWindowEx(0, windowClass.lpszClassName, title.c_str(), WS_OVERLAPPEDWINDOW, CW_USEDEFAULT,
	                            CW_USEDEFAULT, width, height, nullptr, nullptr, instance, nullptr);
	if (hwnd == nullptr) {
		throw std::runtime_error("Window: CreateWindowEx failed");
	}
	windowHandle = hwnd;

	HDC hdc = GetDC(hwnd);
	deviceContext = hdc;

	PIXELFORMATDESCRIPTOR pfd = {};
	pfd.nSize = sizeof(pfd);
	pfd.nVersion = 1;
	pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
	pfd.iPixelType = PFD_TYPE_RGBA;
	pfd.cColorBits = 32;
	pfd.cDepthBits = 24;

	const int pixelFormat = ChoosePixelFormat(hdc, &pfd);
	SetPixelFormat(hdc, pixelFormat, &pfd);

	HGLRC hglrc = wglCreateContext(hdc);
	wglMakeCurrent(hdc, hglrc);
	glContext = hglrc;

	glewExperimental = GL_TRUE;
	if (glewInit() != GLEW_OK) {
		throw std::runtime_error("Window: glewInit failed");
	}

	ShowWindow(hwnd, SW_SHOW);
}

Window::~Window()
{
	if (glContext != nullptr) {
		wglMakeCurrent(nullptr, nullptr);
		wglDeleteContext(static_cast<HGLRC>(glContext));
	}
	if (windowHandle != nullptr && deviceContext != nullptr) {
		ReleaseDC(static_cast<HWND>(windowHandle), static_cast<HDC>(deviceContext));
	}
	if (windowHandle != nullptr) {
		DestroyWindow(static_cast<HWND>(windowHandle));
	}
}

void Window::run(const std::function<void()>& onFrame, const std::function<void(int)>& onKeyDown)
{
	WindowUserData userData;
	userData.closeRequested = &closeRequested;
	userData.onKeyDown = &onKeyDown;
	SetWindowLongPtr(static_cast<HWND>(windowHandle), GWLP_USERDATA, reinterpret_cast<LONG_PTR>(&userData));

	MSG message;
	while (!closeRequested) {
		while (PeekMessage(&message, nullptr, 0, 0, PM_REMOVE)) {
			if (message.message == WM_QUIT) {
				closeRequested = true;
			}
			TranslateMessage(&message);
			DispatchMessage(&message);
		}
		if (closeRequested) {
			break;
		}
		onFrame();
		swapBuffers();
	}
}

void Window::swapBuffers()
{
	SwapBuffers(static_cast<HDC>(deviceContext));
}

} // namespace mvp::client
