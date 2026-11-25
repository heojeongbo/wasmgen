package calc

import "example.test/offset"

func Add(value float64) float64 {
	return value + offset.Value()
}
