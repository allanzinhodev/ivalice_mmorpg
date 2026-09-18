---
name: tfs-coding-style
description: Guia de estilo de codigo baseado no TFS Coding Style Guide (otland/forgottenserver wiki), adaptado ao que o codigo real do server/ deste projeto de fato usa. Use ao escrever qualquer C++ novo em mvp/ (client, server, mapeditor, shared, engine).
---

# Estilo de código C++ para `mvp/`

Base: [TFS Coding Style Guide](https://github.com/otland/forgottenserver/wiki/TFS-Coding-Style-Guide)
(deriva da Google C++ Style Guide, com exceções: tabs, limite de 120 colunas,
braces no estilo Mozilla).

**Regra de precedência**: onde a wiki e o código real de `server/src/`
divergirem, **o código real vence** — a wiki descreve a intenção geral do
projeto TFS upstream, mas este fork já tem convenções próprias estabelecidas.
Duas divergências já confirmadas (ver `creature.h`, `game.cpp`):

- **Sem prefixo `m_`/`mb_`/`mcb_` em membros.** A wiki (via Google Style)
  sugere `m_StartMark`; o código real usa `lowerCamelCase` puro, sem prefixo
  (`name`, `position`, `lastPosition` em `creature.h`). Siga o código real.
- **Classes/funções: brace na linha seguinte (Allman).** A wiki mostra brace
  de classe na mesma linha (`class MyClass {`); o código real abre classe e
  função sempre numa nova linha (`class Creature\n{`). `if`/`for`/`while`/
  `switch` continuam com brace na mesma linha — nisso wiki e código real
  concordam.

## Nomenclatura

| Elemento | Convenção | Exemplo |
|---|---|---|
| Classes/tipos/enums | `CamelCase` | `Creature`, `NetworkMessage` |
| Funções/métodos | `lowerCamelCase` | `getPosition()`, `sendMoveCreature()` |
| Métodos booleanos | prefixo `is`/`has`/`can` | `isPaused()`, `hasLicense()` |
| Variáveis locais | `lowerCamelCase`, sempre inicializadas | `int totalRunning = 0;` |
| Membros de classe | `lowerCamelCase`, **sem prefixo `m_`** | `position`, `lastPosition` |
| Variáveis globais | prefixo `g_`, evitar ao máximo | `g_game` |
| Constantes/enumeradores | `ALL_CAPITALS`; preferir `enum class` | `MAX_SIZE`, `enum class Direction` |
| Arquivos | `lowercase` (padrão já usado em `server/src`, ex. `creature.h`) | `creature.h`, `map_view.cpp` |
| Diretórios | `lowerCamelCase` ou `lowercase` conforme já usado (`net/`, `map/`) | |
| Namespaces | `lowerCamelCase`, conteúdo não indentado | |

**Overload evasivo**: preferir nomes explícitos a sobrecarga ambígua —
`getAnimByIndex(int)` / `getAnimByName(const char*)`, não dois `getAnim(...)`
sobrecarregados.

## Braces

```cpp
// função e classe: brace na linha seguinte
void doWork()
{
    ...
}

class Creature : public Thing
{
public:
    ...
private:
    ...
};

// if / for / while / switch: brace na mesma linha
if (condition) {
    doIt();
} else {
    doOther();
}

for (int i = 0; i < 10; ++i) {
    ...
}
```

Nunca `else` depois de `return`:

```cpp
if (foo) {
    return 1;
}
return 2;
```

## Includes

Ordem: header correspondente ao `.cpp` primeiro → headers do projeto →
bibliotecas de terceiros → STL (usar `<cstdio>`, não `<stdio.h>`).

## Smart pointers e recursos

- Preferir `std::unique_ptr`/`std::shared_ptr`; evitar `new`/`delete` manual.
- Preferir `unique_ptr` sobre `shared_ptr` quando não há necessidade real de
  posse compartilhada.
- Deletar cópia quando não copiável: `Foo(const Foo&) = delete;`.

## Const-correctness

- Parâmetros de referência para tipos não triviais: `const T&`.
- Métodos que não mutam estado: marcar `const`.
- `const` à direita do tipo quando ajuda legibilidade em ponteiros:
  `const int* p` (ponteiro para const), `int* const p` (const ponteiro).

## `auto`

Usar quando aumenta legibilidade (iteradores, resultado de `make_shared`);
nunca com `braced-init-list` (`auto d = {1.23}` é `initializer_list`, não
`double`); nunca em membro de classe ou escopo de namespace.

## Casts

Preferir C++-style casts (`static_cast<int>(y)`) a C-style (`(int)y`).

## Inicialização

Sempre inicializar variáveis na declaração. Preferir
`std::array<char, 32> buffer = {};` a array C cru quando praticável.

## Booleanos

`if (something)`, não `if (something != 0)`; `if (myPtr)`, não
`if (myPtr != nullptr)`.

## Templates

```cpp
template <typename T>
void func()
{
    T value = T{};
}
```

## Evitar

- `using namespace std;` em escopo global/namespace.
- RTTI (`dynamic_cast`, `typeid`) fora de casos já estabelecidos no código
  existente.
- Macros para constantes — usar `constexpr`.
- Identificadores com underscore duplo ou `_Maiúscula` inicial.
- Comentar código morto — deletar em vez de comentar.

## Aplicação em `mvp/`

Todo código novo em `mvp/{shared,engine,client,server,mapeditor}` segue este
guia. Como o projeto ainda não tem `.clang-format` próprio para `mvp/`, ao
criar um, alinhar com as regras acima (tabs, 120 colunas, brace Allman em
função/classe e K&R em controle de fluxo).
