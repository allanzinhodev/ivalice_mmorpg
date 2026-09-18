#include "json_value.hpp"

#include <cctype>
#include <stdexcept>

namespace mvp::mapeditor::import
{

namespace
{

class Parser
{
public:
	explicit Parser(const std::string& text) : text(text) {}

	JsonValue parse()
	{
		skipWhitespace();
		JsonValue value = parseValue();
		return value;
	}

private:
	const std::string& text;
	size_t pos = 0;

	char peek() const { return text[pos]; }
	char next() { return text[pos++]; }

	void skipWhitespace()
	{
		while (pos < text.size() && std::isspace(static_cast<unsigned char>(text[pos]))) {
			++pos;
		}
	}

	void expect(char c)
	{
		if (pos >= text.size() || text[pos] != c) {
			throw std::runtime_error("JSON malformado: esperava '" + std::string(1, c) + "'");
		}
		++pos;
	}

	JsonValue parseValue()
	{
		skipWhitespace();
		const char c = peek();
		if (c == '{') {
			return parseObject();
		}
		if (c == '[') {
			return parseArray();
		}
		if (c == '"') {
			return parseString();
		}
		if (c == 'n') {
			pos += 4; // "null"
			JsonValue value;
			value.type = JsonValue::Type::Null;
			return value;
		}
		if (c == 't' || c == 'f') {
			return parseBool();
		}
		return parseNumber();
	}

	JsonValue parseObject()
	{
		expect('{');
		JsonValue value;
		value.type = JsonValue::Type::Object;
		skipWhitespace();
		if (peek() == '}') {
			++pos;
			return value;
		}
		while (true) {
			skipWhitespace();
			JsonValue key = parseString();
			skipWhitespace();
			expect(':');
			JsonValue fieldValue = parseValue();
			value.object.emplace(key.asString(), std::move(fieldValue));
			skipWhitespace();
			if (peek() == ',') {
				++pos;
				continue;
			}
			expect('}');
			break;
		}
		return value;
	}

	JsonValue parseArray()
	{
		expect('[');
		JsonValue value;
		value.type = JsonValue::Type::Array;
		skipWhitespace();
		if (peek() == ']') {
			++pos;
			return value;
		}
		while (true) {
			JsonValue element = parseValue();
			value.array.push_back(std::move(element));
			skipWhitespace();
			if (peek() == ',') {
				++pos;
				continue;
			}
			expect(']');
			break;
		}
		return value;
	}

	JsonValue parseString()
	{
		expect('"');
		JsonValue value;
		value.type = JsonValue::Type::String;
		std::string result;
		while (peek() != '"') {
			char c = next();
			if (c == '\\') {
				char escaped = next();
				switch (escaped) {
					case 'n':
						result.push_back('\n');
						break;
					case 't':
						result.push_back('\t');
						break;
					case '"':
					case '\\':
					case '/':
						result.push_back(escaped);
						break;
					default:
						result.push_back(escaped);
						break;
				}
			} else {
				result.push_back(c);
			}
		}
		++pos; // closing quote
		value.str = std::move(result);
		return value;
	}

	JsonValue parseNumber()
	{
		const size_t start = pos;
		if (peek() == '-') {
			++pos;
		}
		while (pos < text.size() && (std::isdigit(static_cast<unsigned char>(text[pos])) || text[pos] == '.')) {
			++pos;
		}
		JsonValue value;
		value.type = JsonValue::Type::Number;
		value.number = std::stod(text.substr(start, pos - start));
		return value;
	}

	JsonValue parseBool()
	{
		JsonValue value;
		value.type = JsonValue::Type::Number;
		if (peek() == 't') {
			pos += 4; // "true"
			value.number = 1;
		} else {
			pos += 5; // "false"
			value.number = 0;
		}
		return value;
	}
};

} // namespace

JsonValue parseJson(const std::string& text)
{
	Parser parser(text);
	return parser.parse();
}

} // namespace mvp::mapeditor::import
