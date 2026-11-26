#ifdef WASMGEN_SYMBOL_FIXTURE
#error Declaration headers must only be included in the bridge unit
#endif
double translation_unit(double input) { return input * 2; }
