import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';

import { AppComponent } from './app.component';
import { StarlinkVisualizerComponent } from './components/starlink-visualizer/starlink-visualizer.component';
import { SatSummaryComponent } from './components/sat-summary/sat-summary.component';
import { SatInfoComponent } from './components/sat-info/sat-info.component';
import { SatTleComponent } from './components/sat-tle/sat-tle.component';
import { SatChartsComponent } from './components/sat-charts/sat-charts.component';
import { SatPositionComponent } from './components/sat-position/sat-position.component';
import { SatHardwareComponent } from './components/sat-hardware/sat-hardware.component';

@NgModule({
  declarations: [
  AppComponent,
  StarlinkVisualizerComponent,
  SatSummaryComponent,
  SatInfoComponent,
  SatTleComponent,
  SatChartsComponent,
  SatPositionComponent,
  SatHardwareComponent
  ],
  imports: [
    BrowserModule,
    FormsModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule {}
