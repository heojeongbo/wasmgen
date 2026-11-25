package logic

import (
	"fmt"
	"strings"
	"time"
)

func Upper(value string) string { return strings.ToUpper(value) }

func Scale(values []float64, factor float64) []float64 {
	result := make([]float64, len(values))
	for i, value := range values {
		result[i] = value * factor
	}
	return result
}

func Divide(a, b float64) (float64, error) {
	if b == 0 {
		return 0, fmt.Errorf("division by zero")
	}
	return a / b, nil
}

func Negate(value bool) bool       { return !value }
func Signed(value int32) int32     { return value }
func Unsigned(value uint32) uint32 { return value }
func Empty() []float64             { return nil }
func Notify()                      {}
func Fail()                        { panic("fixture panic") }

// DelayedDouble waits for a child goroutine through a channel. Browser tests
// exercise the JS event-loop handoff needed for time.Sleep to resume.
func DelayedDouble(value float64, milliseconds int32) (float64, error) {
	if milliseconds < 0 {
		return 0, fmt.Errorf("delay must be nonnegative")
	}
	result := make(chan float64)
	go func() {
		time.Sleep(time.Duration(milliseconds) * time.Millisecond)
		result <- value * 2
	}()
	return <-result, nil
}
