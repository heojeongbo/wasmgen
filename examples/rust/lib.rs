mod helpers;

pub fn label(value: String) -> String {
    format!("Rust: {}", crate::helpers::identity(value))
}

pub fn scale(values: Vec<f64>, factor: f64) -> Vec<f64> {
    values.into_iter().map(|value| value * factor).collect()
}

pub fn signed(values: Vec<i32>) -> Vec<i32> {
    values
}
pub fn unsigned(values: Vec<u32>) -> Vec<u32> {
    values
}
pub fn signed_scalar(value: i32) -> i32 {
    value
}
pub fn unsigned_scalar(value: u32) -> u32 {
    value
}
pub fn negate(value: bool) -> bool {
    !value
}
pub fn notify() {}

pub fn divide(a: f64, b: f64) -> Result<f64, &'static str> {
    if b == 0.0 {
        Err("division by zero")
    } else {
        Ok(a / b)
    }
}

pub fn checked_values(valid: bool) -> Result<Vec<f64>, &'static str> {
    if valid {
        Ok(vec![1.0, 2.0])
    } else {
        Err("invalid values")
    }
}

pub fn checked_notify(valid: bool) -> Result<(), &'static str> {
    if valid {
        Ok(())
    } else {
        Err("notification rejected")
    }
}

pub fn fail() {
    panic!("fixture panic");
}

pub fn busy() {
    loop {
        std::hint::spin_loop();
    }
}
