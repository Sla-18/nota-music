package com.notamusic;

import android.app.Application;
import com.facebook.react.ReactApplication;
import com.facebook.react.ReactNativeHost;
import com.facebook.react.ReactPackage;
import com.facebook.react.defaults.DefaultReactNativeHost;
import com.facebook.soloader.SoLoader;
import java.util.ArrayList;
import java.util.List;

public class MainApplication extends Application implements ReactApplication {
    private final ReactNativeHost mReactNativeHost = new DefaultReactNativeHost(this) {
        @Override
        public boolean getUseDeveloperSupport() { return false; }

        @Override
        protected List<ReactPackage> getPackages() {
            return new ArrayList<>();
        }

        @Override
        protected String getJSMainModuleName() { return "index"; }

        @Override
        protected boolean isNewArchEnabled() { return false; }

        @Override
        protected Boolean isHermesEnabled() { return true; }
    };

    @Override
    public ReactNativeHost getReactNativeHost() { return mReactNativeHost; }

    @Override
    public void onCreate() {
        super.onCreate();
        SoLoader.init(this, false);
    }
}
