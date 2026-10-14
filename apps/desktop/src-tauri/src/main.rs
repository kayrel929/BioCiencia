// Sin ventana de consola en la versión instalada de Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    biociencia_lib::run()
}
