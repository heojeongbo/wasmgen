#pragma once
#define WASMGEN_SYMBOL_FIXTURE
#include "detail/factor.h"

// The bridge prelude supplies standard types before declaration headers.
inline double val(double input) { return input * native_factor; }
inline double args(double input) { return input * native_factor; }
inline double result(double input) { return input * native_factor; }
inline double arg0(double input) { return input * native_factor; }
inline double size0(double input) { return input * native_factor; }
inline double j(double input) { return input * native_factor; }
inline double array(double input) { return input * native_factor; }
inline double call_0(double input) { return input * native_factor; }
inline double wasmgen_module(double input) { return input * native_factor; }
inline std::vector<double> value(std::vector<double> input) {
  for (auto& item : input) item *= native_factor;
  return input;
}
double translation_unit(double input);
