package com.yeeroo.bkvchallenge;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/** Lists the newest photos on the phone as small thumbnails and returns a chosen one scaled down. */
@CapacitorPlugin(
    name = "RecentPhotos",
    permissions = {
        @Permission(alias = "images", strings = { Manifest.permission.READ_MEDIA_IMAGES }),
        @Permission(alias = "legacy", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
    }
)
public class RecentPhotosPlugin extends Plugin {

    private String alias() {
        return Build.VERSION.SDK_INT >= 33 ? "images" : "legacy";
    }

    @PluginMethod
    public void recent(PluginCall call) {
        if (getPermissionState(alias()) != PermissionState.GRANTED) {
            requestPermissionForAlias(alias(), call, "recentPermission");
            return;
        }
        loadRecent(call);
    }

    @PermissionCallback
    private void recentPermission(PluginCall call) {
        if (getPermissionState(alias()) == PermissionState.GRANTED) {
            loadRecent(call);
        } else {
            call.reject("Photo permission denied");
        }
    }

    private void loadRecent(PluginCall call) {
        int limit = call.getInt("limit", 45);
        int size = call.getInt("size", 240);
        ContentResolver cr = getContext().getContentResolver();
        Uri base = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        String[] projection = { MediaStore.Images.Media._ID };
        JSArray photos = new JSArray();
        try (Cursor c = cr.query(base, projection, null, null, MediaStore.Images.Media.DATE_ADDED + " DESC")) {
            if (c != null) {
                int idCol = c.getColumnIndexOrThrow(MediaStore.Images.Media._ID);
                while (c.moveToNext() && photos.length() < limit) {
                    Uri uri = ContentUris.withAppendedId(base, c.getLong(idCol));
                    try {
                        Bitmap bmp = decode(cr, uri, size);
                        if (bmp == null) continue;
                        JSObject o = new JSObject();
                        o.put("id", uri.toString());
                        o.put("thumb", "data:image/jpeg;base64," + toBase64(bmp, 70));
                        photos.put(o);
                    } catch (Exception ignored) {
                        // skip a photo that cannot be read
                    }
                }
            }
        } catch (Exception e) {
            call.reject("Could not read photos: " + e.getMessage());
            return;
        }
        JSObject ret = new JSObject();
        ret.put("photos", photos);
        call.resolve(ret);
    }

    @PluginMethod
    public void full(PluginCall call) {
        String uriStr = call.getString("uri");
        int size = call.getInt("size", 1600);
        if (uriStr == null) {
            call.reject("uri is required");
            return;
        }
        try {
            Bitmap bmp = decode(getContext().getContentResolver(), Uri.parse(uriStr), size);
            if (bmp == null) {
                call.reject("Could not decode photo");
                return;
            }
            JSObject ret = new JSObject();
            ret.put("data", toBase64(bmp, 85));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not read photo: " + e.getMessage());
        }
    }

    /** Decode no larger than needed, then apply the EXIF rotation and cap the long side at target. */
    private Bitmap decode(ContentResolver cr, Uri uri, int target) throws Exception {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream in = cr.openInputStream(uri)) {
            BitmapFactory.decodeStream(in, null, bounds);
        }
        int sample = 1;
        while (bounds.outWidth / (sample * 2) >= target && bounds.outHeight / (sample * 2) >= target) {
            sample *= 2;
        }
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        Bitmap bmp;
        try (InputStream in = cr.openInputStream(uri)) {
            bmp = BitmapFactory.decodeStream(in, null, opts);
        }
        if (bmp == null) return null;

        int rotation = 0;
        try (InputStream in = cr.openInputStream(uri)) {
            int o = new ExifInterface(in).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            if (o == ExifInterface.ORIENTATION_ROTATE_90) rotation = 90;
            else if (o == ExifInterface.ORIENTATION_ROTATE_180) rotation = 180;
            else if (o == ExifInterface.ORIENTATION_ROTATE_270) rotation = 270;
        } catch (Exception ignored) {
            // no EXIF data: leave as is
        }
        float scale = Math.min(1f, (float) target / Math.max(bmp.getWidth(), bmp.getHeight()));
        if (rotation != 0 || scale < 1f) {
            Matrix m = new Matrix();
            if (rotation != 0) m.postRotate(rotation);
            if (scale < 1f) m.postScale(scale, scale);
            bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
        }
        return bmp;
    }

    private String toBase64(Bitmap bmp, int quality) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.JPEG, quality, out);
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }
}
