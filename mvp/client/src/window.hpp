#pragma once

#include <functional>
#include <string>

namespace mvp::client
{

// Janela Win32 + contexto WGL mínimo -- mesma abordagem do client atual
// (client/src/framework/platform/win32window.cpp), sem trazer SDL/GLFW ao
// vcpkg do MVP.
class Window
{
public:
	Window(int width, int height, const std::string& title);
	~Window();

	Window(const Window&) = delete;
	Window& operator=(const Window&) = delete;

	// Roda o loop de mensagens/render até a janela ser fechada. onFrame é
	// chamado uma vez por quadro, antes do swap de buffers.
	void run(const std::function<void()>& onFrame);

	void swapBuffers();
	bool shouldClose() const { return closeRequested; }

private:
	void* windowHandle = nullptr;
	void* deviceContext = nullptr;
	void* glContext = nullptr;
	bool closeRequested = false;
};

} // namespace mvp::client
