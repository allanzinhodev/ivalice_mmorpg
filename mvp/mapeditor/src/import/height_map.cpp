#include "height_map.hpp"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <sstream>
#include <stdexcept>

namespace mvp::mapeditor::import
{

namespace
{

std::string readWholeFile(const std::string& path)
{
	std::ifstream file(path);
	if (!file) {
		throw std::runtime_error("loadHeightMap: cannot open " + path);
	}
	std::ostringstream buffer;
	buffer << file.rdbuf();
	return buffer.str();
}

size_t skipWhitespace(const std::string& json, size_t pos)
{
	while (pos < json.size() && std::isspace(static_cast<unsigned char>(json[pos]))) {
		++pos;
	}
	return pos;
}

// Encontra o valor de um campo "campo": <valor> a partir de `searchFrom`,
// tolerando qualquer quantidade de espaço/quebra de linha entre ':' e o
// valor (o JSON real vem formatado com indentação, diferente do JSON
// compacto usado nos testes iniciais).
size_t findFieldValueStart(const std::string& json, size_t searchFrom, const std::string& field)
{
	const std::string needle = "\"" + field + "\"";
	size_t pos = json.find(needle, searchFrom);
	if (pos == std::string::npos) {
		throw std::runtime_error("loadHeightMap: campo '" + field + "' não encontrado");
	}
	pos += needle.size();
	pos = skipWhitespace(json, pos);
	if (json[pos] != ':') {
		throw std::runtime_error("loadHeightMap: campo '" + field + "' sem ':'");
	}
	++pos;
	return skipWhitespace(json, pos);
}

// Encontra o objeto JSON, dentro do array "mapas", cujo campo "index" bate
// com mapIndex. Devolve o offset do '{' de abertura desse objeto.
size_t findMapObject(const std::string& json, int mapIndex)
{
	size_t searchFrom = 0;
	while (true) {
		const size_t valueStart = findFieldValueStart(json, searchFrom, "index");
		size_t valueEnd = valueStart;
		while (valueEnd < json.size() && std::isdigit(static_cast<unsigned char>(json[valueEnd]))) {
			++valueEnd;
		}
		const int foundIndex = std::stoi(json.substr(valueStart, valueEnd - valueStart));
		if (foundIndex == mapIndex) {
			const size_t objectStart = json.rfind('{', valueStart);
			if (objectStart == std::string::npos) {
				throw std::runtime_error("loadHeightMap: JSON malformado ao redor do índice encontrado");
			}
			return objectStart;
		}
		searchFrom = valueEnd;
		if (searchFrom >= json.size()) {
			throw std::runtime_error("loadHeightMap: mapa " + std::to_string(mapIndex) + " não encontrado no JSON");
		}
	}
}

int extractIntField(const std::string& json, size_t start, const std::string& field)
{
	const size_t valueStart = findFieldValueStart(json, start, field);
	size_t valueEnd = valueStart;
	while (valueEnd < json.size() &&
	       (std::isdigit(static_cast<unsigned char>(json[valueEnd])) || json[valueEnd] == '-')) {
		++valueEnd;
	}
	return std::stoi(json.substr(valueStart, valueEnd - valueStart));
}

// Extrai a grade "grade": [[...],[...],...] a partir de `start`, parseando
// o array de arrays de inteiros por varredura de caracteres.
std::vector<std::vector<uint8_t>> extractGrid(const std::string& json, size_t start)
{
	size_t pos = findFieldValueStart(json, start, "grade");
	if (json[pos] != '[') {
		throw std::runtime_error("loadHeightMap: 'grade' não é um array");
	}

	std::vector<std::vector<uint8_t>> grid;
	std::vector<uint8_t> currentRow;
	std::string currentNumber;
	int depth = 0;

	auto flushNumber = [&]() {
		if (!currentNumber.empty()) {
			currentRow.push_back(static_cast<uint8_t>(std::stoi(currentNumber)));
			currentNumber.clear();
		}
	};

	for (size_t i = pos; i < json.size(); ++i) {
		const char c = json[i];
		if (c == '[') {
			++depth;
			if (depth == 2) {
				currentRow.clear();
			}
		} else if (c == ']') {
			flushNumber();
			--depth;
			if (depth == 1) {
				grid.push_back(currentRow);
			} else if (depth == 0) {
				break;
			}
		} else if (c == ',') {
			flushNumber();
		} else if (std::isdigit(static_cast<unsigned char>(c)) || c == '-') {
			currentNumber.push_back(c);
		}
	}

	return grid;
}

} // namespace

HeightMap loadHeightMap(const std::string& jsonPath, int mapIndex)
{
	const std::string json = readWholeFile(jsonPath);
	const size_t objectStart = findMapObject(json, mapIndex);

	HeightMap result;
	result.width = extractIntField(json, objectStart, "largura");
	result.height = extractIntField(json, objectStart, "altura");
	result.minHeight = static_cast<uint8_t>(extractIntField(json, objectStart, "min"));
	result.grid = extractGrid(json, objectStart);

	if (static_cast<int>(result.grid.size()) != result.height) {
		throw std::runtime_error("loadHeightMap: número de linhas da grade não bate com 'altura'");
	}
	for (const auto& row : result.grid) {
		if (static_cast<int>(row.size()) != result.width) {
			throw std::runtime_error("loadHeightMap: número de colunas da grade não bate com 'largura'");
		}
	}

	return result;
}

} // namespace mvp::mapeditor::import
