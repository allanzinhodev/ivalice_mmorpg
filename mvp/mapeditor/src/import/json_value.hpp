#pragma once

#include <map>
#include <memory>
#include <string>
#include <vector>

namespace mvp::mapeditor::import
{

// Parser JSON mínimo, escrito à mão -- o outfits.json exportado por
// tools/ffta2-extract/export-outfits-png.js tem estrutura aninhada
// (array de outfits -> array de grupos -> array de frames -> objetos
// dry/wet), mais complexa que o height_map.cpp consegue ler ad-hoc, mas
// ainda simples o suficiente para não justificar trazer uma lib JSON
// completa (regra de dependência mínima do projeto).
class JsonValue
{
public:
	enum class Type
	{
		Null,
		Number,
		String,
		Array,
		Object,
	};

	Type type = Type::Null;
	double number = 0.0;
	std::string str;
	std::vector<JsonValue> array;
	std::map<std::string, JsonValue> object;

	int asInt() const { return static_cast<int>(number); }
	const std::string& asString() const { return str; }

	const JsonValue& at(const std::string& key) const { return object.at(key); }
	bool has(const std::string& key) const { return object.find(key) != object.end(); }
};

JsonValue parseJson(const std::string& text);

} // namespace mvp::mapeditor::import
