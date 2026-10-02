use sha2::{Digest, Sha256};
use std::{env, fs, path::PathBuf, process::Command};

fn main() {
    let root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("Cargo manifest directory"))
        .join("../..");
    let quality = env::var("SPIRIT_PRODUCT_QUALITY").unwrap_or_else(|_| "stable".into());
    let inputs = [
        "product.json",
        "packages/product/schema.ts",
        "packages/product/scripts/generate.mjs",
    ];
    for input in &inputs {
        println!("cargo:rerun-if-changed={}", root.join(input).display());
    }
    println!("cargo:rerun-if-env-changed=SPIRIT_PRODUCT_QUALITY");
    println!("cargo:rerun-if-env-changed=SPIRIT_PRODUCT_ARTIFACT_DIR");

    let out = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo output directory"));
    if let Some(prebuilt) = env::var_os("SPIRIT_PRODUCT_ARTIFACT_DIR") {
        let prebuilt = root.join(prebuilt);
        let stamp_path = prebuilt.join("inputs.sha256");
        let rust_path = prebuilt.join("product.rs");
        println!("cargo:rerun-if-changed={}", stamp_path.display());
        println!("cargo:rerun-if-changed={}", rust_path.display());
        let stamp = fs::read_to_string(stamp_path).expect("Read pre-generated product fingerprint");
        let rust = fs::read(&rust_path).expect("Read pre-generated Rust product");
        let mut hash = Sha256::new();
        hash.update(quality.as_bytes());
        hash.update(b"\0");
        for input in &inputs {
            hash.update(input.as_bytes());
            hash.update(b"\0");
            hash.update(fs::read(root.join(input)).expect("Read product generator input"));
            hash.update(b"\0");
        }
        let expected = format!(
            "{}\n{:x}\n{:x}\n",
            quality,
            hash.finalize(),
            Sha256::digest(&rust)
        );
        assert_eq!(
            stamp, expected,
            "Pre-generated product is stale or has the wrong quality; rerun the Node generator"
        );
        fs::write(out.join("product.rs"), rust).expect("Write generated Rust product");
    } else {
        let status = Command::new("node")
            .arg(root.join("packages/product/scripts/generate.mjs"))
            .args(["--quality", &quality, "--out-dir"])
            .arg(&out)
            .status()
            .expect("Product generation requires Node.js 24 and installed workspace dependencies");
        assert!(
            status.success(),
            "Product schema validation or generation failed"
        );
    }
}
