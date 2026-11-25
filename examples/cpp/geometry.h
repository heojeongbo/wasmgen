#pragma once
#include <string>
#include <vector>

namespace geometry {
double Clamp(double value, double low, double high);
std::vector<double> Scale(const std::vector<double>& values, double factor);
std::string Greet(const std::string& name);
double Divide(double a, double b);
void Busy(double milliseconds);
}
