package com.ahmadjalil.tcger.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import com.ahmadjalil.tcger.MainActivity
import com.ahmadjalil.tcger.R

class QuickActionsWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { id ->
            val views = RemoteViews(context.packageName, R.layout.quick_actions_widget)
            fun open(destination: String, request: Int) = PendingIntent.getActivity(context, request,
                Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse("tcger://$destination")),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            views.setOnClickPendingIntent(R.id.widget_scan, open("scan", 1))
            views.setOnClickPendingIntent(R.id.widget_search, open("search", 2))
            manager.updateAppWidget(id, views)
        }
    }
}
