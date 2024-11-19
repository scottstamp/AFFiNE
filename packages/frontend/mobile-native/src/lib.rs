use affine_common::hashcash::Stamp;

uniffi::setup_scaffolding!("affine_mobile_native");

#[uniffi::export]
pub fn hashcash_mint(resource: String) -> String {
  Stamp::mint(resource, None).format()
}

#[no_mangle]
pub extern "C" fn Java_app_affine_pro_MainActivity_hello() -> i32 {
  100
}
