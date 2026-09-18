#pragma once

#include <cstdint>
#include <cstring>
#include <stdexcept>
#include <vector>

namespace mvp::shared
{

// Leitor/escritor binário little-endian mínimo. Sem dependência externa de
// propósito -- parsing de .dat/.spr/.mvpmap e do protocolo de rede não
// precisa de nenhuma biblioteca de serialização.
class ByteWriter
{
public:
	void writeU8(uint8_t value) { buffer.push_back(value); }

	void writeU16(uint16_t value)
	{
		buffer.push_back(static_cast<uint8_t>(value & 0xFF));
		buffer.push_back(static_cast<uint8_t>((value >> 8) & 0xFF));
	}

	void writeU32(uint32_t value)
	{
		for (int shift = 0; shift < 32; shift += 8) {
			buffer.push_back(static_cast<uint8_t>((value >> shift) & 0xFF));
		}
	}

	void writeBytes(const uint8_t* data, size_t count) { buffer.insert(buffer.end(), data, data + count); }

	const std::vector<uint8_t>& data() const { return buffer; }

private:
	std::vector<uint8_t> buffer;
};

class ByteReader
{
public:
	ByteReader(const uint8_t* data, size_t size) : data(data), size(size) {}

	uint8_t readU8()
	{
		requireAvailable(1);
		return data[position++];
	}

	uint16_t readU16()
	{
		requireAvailable(2);
		uint16_t value = static_cast<uint16_t>(data[position]) | (static_cast<uint16_t>(data[position + 1]) << 8);
		position += 2;
		return value;
	}

	uint32_t readU32()
	{
		requireAvailable(4);
		uint32_t value = 0;
		for (int i = 0; i < 4; ++i) {
			value |= static_cast<uint32_t>(data[position + i]) << (8 * i);
		}
		position += 4;
		return value;
	}

	void readBytes(uint8_t* out, size_t count)
	{
		requireAvailable(count);
		std::memcpy(out, data + position, count);
		position += count;
	}

	bool atEnd() const { return position >= size; }

private:
	void requireAvailable(size_t count) const
	{
		if (position + count > size) {
			throw std::out_of_range("ByteReader: read past end of buffer");
		}
	}

	const uint8_t* data;
	size_t size;
	size_t position = 0;
};

} // namespace mvp::shared
