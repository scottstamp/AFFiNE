package app.affine.pro

import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.annotation.RequiresApi
import com.getcapacitor.BridgeActivity
import uniffi.affine_mobile_native.hashcashMint;

class MainActivity : BridgeActivity() {
    init {
        System.loadLibrary("affine_mobile_native")
    }

    external fun hello(): Long

    @RequiresApi(Build.VERSION_CODES.R)
    override fun onCreate(savedInstanceState: Bundle?) {
        val ret = hello()
        println("ret from rust side $ret")
        val resource = "hello"
        val hashed = hashcashMint(resource)
        println("Hashed string from Rust $hashed")
        super.onCreate(savedInstanceState)
    }
}
