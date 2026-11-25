#include "geometry.h"
#include <algorithm>
#include <chrono>
#include <stdexcept>

namespace geometry {
double Clamp(double value, double low, double high) {
  return std::max(low, std::min(high, value));
}
std::vector<double> Scale(const std::vector<double>& values, double factor) {
  std::vector<double> result;
  result.reserve(values.size());
  for (const auto value : values) result.push_back(value * factor);
  return result;
}
std::string Greet(const std::string& name) { return "hello, " + name; }
double Divide(double a, double b) {
  if (b == 0) throw std::invalid_argument("division by zero");
  return a / b;
}
void Busy(double milliseconds) {
  const auto end = std::chrono::steady_clock::now() + std::chrono::duration<double, std::milli>(milliseconds);
  while (std::chrono::steady_clock::now() < end) {}
}
}
